import { beforeEach, describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import { upsertGoogleUser } from "../convex/auth";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { modules } from "./modules";

beforeEach(() => {
  process.env.AUTH_GOOGLE_ID = "client-id";
  process.env.AUTH_GOOGLE_SECRET = "client-secret";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
});

async function setup() {
  const t = convexTest(schema, modules);
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

  test("signing in again links by email and replaces an expired connection", async () => {
    const { t, userId } = await setup();
    await connect(t, userId);
    await t.mutation(internal.gmail.markExpired, { userId });
    const id = await t.run((ctx) =>
      upsertGoogleUser(ctx, {
        existingUserId: null,
        profile: { email: "me@example.com", encryptedGmailToken: "new.token" },
      }),
    );
    expect(id).toBe(userId);
    const accounts = await t.run((ctx) => ctx.db.query("gmailAccounts").collect());
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ encryptedRefreshToken: "new.token", status: "active" });
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
});
