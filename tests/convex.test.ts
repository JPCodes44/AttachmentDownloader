import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import { upsertGoogleUser } from "../convex/auth";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { MAX_ATTACHMENTS_PER_SCAN, MAX_MESSAGES_PER_SCAN } from "../convex/limits";
import { STALE_AFTER_MS } from "../convex/scans";
import { modules, registerComponents } from "./modules";

beforeEach(() => {
  process.env.AUTH_GOOGLE_ID = "client-id";
  process.env.AUTH_GOOGLE_SECRET = "client-secret";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  // Scheduled functions (scanPage, cleanup) only run when a test asks, never on a racing timer.
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  await registerComponents(t);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "me@example.com" }));
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 60_000 }),
  );
  const asUser = t.withIdentity({ subject: `${userId}|${sessionId}` });
  return { t, userId, asUser };
}

const connect = (t: ReturnType<typeof convexTest>, userId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("gmailAccounts", {
      userId,
      email: "me@gmail.com",
      encryptedRefreshToken: "x.y",
      status: "active",
      connectedAt: Date.now(),
    }),
  );

describe("auth enforcement", () => {
  test("signed-out callers are rejected", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.scans.start, { query: "", extensions: [] })).rejects.toThrow();
    expect(await t.query(api.gmail.status, {})).toBeNull();
  });

  test("a user cannot read another user's scan", async () => {
    const { t, userId, asUser } = await setup();
    await connect(t, userId);
    const scanId = await asUser.mutation(api.scans.start, { query: "", extensions: [] });
    const other = await t.run((ctx) => ctx.db.insert("users", {}));
    const otherSession = await t.run((ctx) =>
      ctx.db.insert("authSessions", { userId: other, expirationTime: Date.now() + 60_000 }),
    );
    const asOther = t.withIdentity({ subject: `${other}|${otherSession}` });
    await expect(asOther.query(api.scans.get, { scanId })).rejects.toThrow("Scan not found");
  });
});

describe("Google sign-in", () => {
  test("a new user gets an account and a Gmail connection, with no token on the user doc", async () => {
    const { t } = await setup();
    const id = await t.run((ctx) =>
      upsertGoogleUser(ctx, {
        existingUserId: null,
        profile: { email: "new@gmail.com", name: "New", encryptedGmailToken: "iv.cipher" },
      }),
    );
    const user = await t.run((ctx) => ctx.db.get(id));
    expect(user).toMatchObject({ email: "new@gmail.com", name: "New" });
    expect(JSON.stringify(user)).not.toContain("iv.cipher");
    const account = await t.run((ctx) =>
      ctx.db.query("gmailAccounts").withIndex("by_user", (q) => q.eq("userId", id)).unique(),
    );
    expect(account).toMatchObject({ email: "new@gmail.com", encryptedRefreshToken: "iv.cipher", status: "active" });
  });

  test("signing in again replaces an expired connection", async () => {
    const { t, userId } = await setup();
    await connect(t, userId);
    await t.mutation(internal.gmail.markExpired, { userId });
    const id = await t.run((ctx) =>
      upsertGoogleUser(ctx, {
        existingUserId: userId,
        profile: { email: "me@example.com", encryptedGmailToken: "new.token" },
      }),
    );
    expect(id).toBe(userId);
    const accounts = await t.run((ctx) => ctx.db.query("gmailAccounts").collect());
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ encryptedRefreshToken: "new.token", status: "active" });
  });

  test("a different Google account with the same email gets its own user, not the existing Gmail", async () => {
    const { t, userId } = await setup();
    await connect(t, userId);
    const id = await t.run((ctx) =>
      upsertGoogleUser(ctx, { existingUserId: null, profile: { email: "me@example.com" } }),
    );
    expect(id).not.toBe(userId);
    const theirs = await t.run((ctx) =>
      ctx.db.query("gmailAccounts").withIndex("by_user", (q) => q.eq("userId", id)).unique(),
    );
    expect(theirs).toBeNull();
  });

  test("unticking Gmail on a later sign-in keeps the existing connection", async () => {
    const { t, userId } = await setup();
    await connect(t, userId);
    await t.run((ctx) => upsertGoogleUser(ctx, { existingUserId: userId, profile: { email: "me@example.com" } }));
    const account = await t.run((ctx) =>
      ctx.db.query("gmailAccounts").withIndex("by_user", (q) => q.eq("userId", userId)).unique(),
    );
    expect(account?.encryptedRefreshToken).toBe("x.y");
  });

  test("status reports connection and expiry without leaking tokens", async () => {
    const { t, userId, asUser } = await setup();
    expect(await asUser.query(api.gmail.status, {})).toEqual({ connected: false });
    await connect(t, userId);
    expect(await asUser.query(api.gmail.status, {})).toEqual({
      connected: true,
      email: "me@gmail.com",
      status: "active",
    });
    await t.mutation(internal.gmail.markExpired, { userId });
    expect((await asUser.query(api.gmail.status, {}))?.connected && "expired").toBe("expired");
    await expect(asUser.mutation(api.scans.start, { query: "", extensions: [] })).rejects.toThrow();
  });
});

describe("scans", () => {
  const attachment = (n: number, isInline = false) => ({
    messageId: `m${n}`,
    attachmentId: `a${n}`,
    filename: `file${n}.pdf`,
    mimeType: "application/pdf",
    size: 100 * n,
    from: "a@b.c",
    subject: "s",
    date: n,
    isInline,
  });

  test("pages are recorded, counted and listed newest first", async () => {
    const { t, userId, asUser } = await setup();
    await connect(t, userId);
    const scanId = await asUser.mutation(api.scans.start, { query: "from:bob", extensions: [".PDF"] });

    const scan = await asUser.query(api.scans.get, { scanId });
    expect(scan.query).toBe("from:bob has:attachment");
    expect(scan.extensions).toEqual(["pdf"]);

    await t.mutation(internal.scans.recordPage, {
      scanId,
      attachments: [attachment(1), attachment(2, true)],
      messagesScanned: 100,
      nextPageToken: "p2",
    });
    await t.mutation(internal.scans.recordPage, {
      scanId,
      attachments: [attachment(3)],
      messagesScanned: 40,
    });

    const done = await asUser.query(api.scans.latest, {});
    expect(done).toMatchObject({ status: "done", messagesScanned: 140, attachmentsFound: 2, inlineFound: 1 });

    const page = await asUser.query(api.attachments.list, {
      scanId,
      includeInline: false,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page.map((a) => a.filename)).toEqual(["file3.pdf", "file1.pdf"]);

    const all = await asUser.query(api.attachments.allForScan, { scanId, includeInline: true });
    expect(all).toHaveLength(3);
  });

  test("cancelled scans drop late results; a new scan cleans up the old one", async () => {
    const { t, userId, asUser } = await setup();
    await connect(t, userId);
    const first = await asUser.mutation(api.scans.start, { query: "", extensions: [] });
    await asUser.mutation(api.scans.cancel, { scanId: first });
    await t.mutation(internal.scans.recordPage, { scanId: first, attachments: [attachment(1)], messagesScanned: 1 });
    expect(await asUser.query(api.scans.get, { scanId: first })).toMatchObject({
      status: "cancelled",
      attachmentsFound: 0,
    });

    const second = await asUser.mutation(api.scans.start, { query: "", extensions: [] });
    await t.mutation(internal.scans.cleanup, { scanId: first });
    expect(await t.run((ctx) => ctx.db.get(first))).toBeNull();
    expect((await asUser.query(api.scans.latest, {}))?._id).toBe(second);
  });

  const runningScan = (t: ReturnType<typeof convexTest>, userId: Id<"users">, fields = {}) =>
    t.run((ctx) =>
      ctx.db.insert("scans", {
        userId,
        query: "has:attachment",
        extensions: [],
        status: "running",
        messagesScanned: 0,
        attachmentsFound: 0,
        inlineFound: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...fields,
      }),
    );

  test("an OR in the search can't escape the attachment filter", async () => {
    const { t, userId, asUser } = await setup();
    await connect(t, userId);
    const scanId = await asUser.mutation(api.scans.start, { query: "x OR in:anywhere", extensions: [] });
    expect((await asUser.query(api.scans.get, { scanId })).query).toBe("(x OR in:anywhere) has:attachment");
  });

  test("oversized searches are rejected", async () => {
    const { t, userId, asUser } = await setup();
    await connect(t, userId);
    await expect(asUser.mutation(api.scans.start, { query: "a".repeat(1001), extensions: [] })).rejects.toThrow(
      "too long",
    );
    await expect(
      asUser.mutation(api.scans.start, { query: "", extensions: Array.from({ length: 51 }, (_, i) => `e${i}`) }),
    ).rejects.toThrow("Too many file types");
  });

  test("starting scans is rate limited per user", async () => {
    const { t, userId, asUser } = await setup();
    await connect(t, userId);
    for (let i = 0; i < 5; i++) await asUser.mutation(api.scans.start, { query: "", extensions: [] });
    await expect(asUser.mutation(api.scans.start, { query: "", extensions: [] })).rejects.toThrow("Too many searches");
  });

  test("a scan stops at the message limit", async () => {
    const { t, userId } = await setup();
    const scanId = await runningScan(t, userId, { messagesScanned: MAX_MESSAGES_PER_SCAN - 50 });
    await t.mutation(internal.scans.recordPage, {
      scanId,
      attachments: [attachment(1)],
      messagesScanned: 100,
      nextPageToken: "more",
    });
    expect(await t.run((ctx) => ctx.db.get(scanId))).toMatchObject({ status: "done", limitReached: true });
  });

  test("a scan stores no more than the attachment limit", async () => {
    const { t, userId } = await setup();
    const scanId = await runningScan(t, userId, { attachmentsFound: MAX_ATTACHMENTS_PER_SCAN - 1 });
    await t.mutation(internal.scans.recordPage, {
      scanId,
      attachments: [attachment(1), attachment(2), attachment(3)],
      messagesScanned: 3,
      nextPageToken: "more",
    });
    const rows = await t.run((ctx) => ctx.db.query("attachments").collect());
    expect(rows).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(scanId))).toMatchObject({
      status: "done",
      limitReached: true,
      attachmentsFound: MAX_ATTACHMENTS_PER_SCAN,
    });
  });

  test("scans that stop making progress are failed, live ones are left alone", async () => {
    const { t, userId } = await setup();
    const stale = await runningScan(t, userId, { updatedAt: Date.now() - STALE_AFTER_MS - 1000 });
    const legacy = await runningScan(t, userId, { updatedAt: undefined });
    const live = await runningScan(t, userId);
    await t.mutation(internal.scans.failStaleScans, {});
    const status = async (id: Id<"scans">) => (await t.run((ctx) => ctx.db.get(id)))?.status;
    expect(await status(stale)).toBe("error");
    expect(await status(legacy)).toBe("error");
    expect(await status(live)).toBe("running");
  });
});

describe("deleting data", () => {
  test("disconnecting Gmail deletes the scan results too", async () => {
    const { t, userId } = await setup();
    await connect(t, userId);
    const scanId = await t.run((ctx) =>
      ctx.db.insert("scans", {
        userId,
        query: "has:attachment",
        extensions: [],
        status: "done",
        messagesScanned: 1,
        attachmentsFound: 1,
        inlineFound: 0,
        createdAt: Date.now(),
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("attachments", {
        scanId,
        userId,
        messageId: "m",
        attachmentId: "a",
        filename: "f.pdf",
        mimeType: "application/pdf",
        size: 1,
        from: "a@b.c",
        subject: "s",
        date: 1,
        isInline: false,
      }),
    );
    await t.mutation(internal.gmail.deleteAccount, { userId });
    await t.finishAllScheduledFunctions(jest.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("gmailAccounts").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("scans").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("attachments").collect())).toHaveLength(0);
  });

  test("deleting an account removes the user, sessions, sign-in accounts and Gmail data", async () => {
    const { t, userId } = await setup();
    await connect(t, userId);
    await t.run((ctx) =>
      ctx.db.insert("authAccounts", { userId, provider: "google", providerAccountId: "sub-1" }),
    );
    await t.mutation(internal.account.deleteUserData, { userId });
    await t.finishAllScheduledFunctions(jest.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(userId))).toBeNull();
    for (const table of ["authAccounts", "authSessions", "gmailAccounts", "scans"] as const) {
      expect(await t.run((ctx) => ctx.db.query(table).collect())).toHaveLength(0);
    }
  });
});
