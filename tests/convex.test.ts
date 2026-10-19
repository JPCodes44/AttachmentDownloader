import { beforeEach, describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
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
  t.mutation(internal.gmail.saveAccount, { userId, email: "me@gmail.com", encryptedRefreshToken: "x.y" });

describe("auth enforcement", () => {
  test("signed-out callers are rejected", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.gmail.createConnectUrl, {})).rejects.toThrow();
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

describe("Gmail connect flow", () => {
  test("createConnectUrl issues a single-use state ticket", async () => {
    const { t, userId, asUser } = await setup();
    const url = new URL(await asUser.mutation(api.gmail.createConnectUrl, {}));
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.convex.site/gmail/callback");
    const state = url.searchParams.get("state")!;

    expect(await t.mutation(internal.gmail.consumeState, { state })).toBe(userId);
    expect(await t.mutation(internal.gmail.consumeState, { state })).toBeNull();
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
