import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import { upsertGoogleUser } from "../convex/auth";
import { CHAT_SCOPES } from "../convex/chatApi";
import { encrypt } from "../convex/crypto";
import { GMAIL_SCOPE } from "../convex/gmailApi";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { MAX_ATTACHMENTS_PER_SCAN, MAX_MESSAGES_PER_SCAN } from "../convex/limits";
import { STALE_AFTER_MS } from "../convex/scans";
import { modules, registerComponents } from "./modules";

beforeEach(() => {
  process.env.AUTH_GOOGLE_ID = "client-id";
  process.env.AUTH_GOOGLE_SECRET = "client-secret";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  process.env.GOOGLE_CHAT = "on";
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
    const scanId = await t.run((ctx) => ctx.db.insert("scans", {
      userId, source: "chat", query: "", extensions: [], status: "running",
      messagesScanned: 0, attachmentsFound: 0, inlineFound: 0, createdAt: Date.now(),
    }));
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
      chatConnected: false,
      driveConnected: false,
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
    const scanId = await t.run((ctx) => ctx.db.insert("scans", {
      userId, source: "chat", query: "from:bob", extensions: ["pdf"], status: "running",
      messagesScanned: 0, attachmentsFound: 0, inlineFound: 0, createdAt: Date.now(),
    }));

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
    const makeScan = () => t.run((ctx) => ctx.db.insert("scans", {
      userId, source: "chat", query: "", extensions: [], status: "running",
      messagesScanned: 0, attachmentsFound: 0, inlineFound: 0, createdAt: Date.now(),
    }));
    const first = await makeScan();
    await asUser.mutation(api.scans.cancel, { scanId: first });
    await t.mutation(internal.scans.recordPage, { scanId: first, attachments: [attachment(1)], messagesScanned: 1 });
    expect(await asUser.query(api.scans.get, { scanId: first })).toMatchObject({
      status: "cancelled",
      attachmentsFound: 0,
    });

    const second = await makeScan();
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

  test("Gmail searches are rejected by Convex", async () => {
    const { asUser } = await setup();
    await expect(asUser.mutation(api.scans.start, { query: "x OR in:anywhere", extensions: [] })).rejects.toThrow(
      "Gmail searches now run locally in your browser",
    );
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

describe("Google Chat", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const connectChat = async (t: ReturnType<typeof convexTest>, userId: Id<"users">) => {
    process.env.TOKEN_ENCRYPTION_KEY = btoa(String.fromCharCode(...new Uint8Array(32)));
    const encryptedRefreshToken = await encrypt("refresh");
    await t.run((ctx) =>
      ctx.db.insert("gmailAccounts", {
        userId,
        email: "me@work.com",
        encryptedRefreshToken,
        status: "active",
        connectedAt: Date.now(),
        scopes: [GMAIL_SCOPE, ...CHAT_SCOPES],
      }),
    );
  };

  // Answers Google by URL path: the token endpoint, then whatever `routes` scripts.
  function stubGoogle(routes: Record<string, () => Response>) {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      const u = new URL(String(url));
      calls.push(u.pathname + (u.searchParams.get("pageToken") ? `?${u.searchParams.get("pageToken")}` : ""));
      if (u.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "access", expires_in: 3600 });
      const route = routes[calls.at(-1)!];
      if (!route) throw new Error(`unexpected fetch ${calls.at(-1)}`);
      return route();
    }) as typeof fetch;
    return calls;
  }

  const upload = (name: string, file: string) => ({
    name,
    createTime: "2026-03-01T10:00:00.000Z",
    attachment: [
      {
        contentName: file,
        contentType: "application/pdf",
        source: "UPLOADED_CONTENT",
        attachmentDataRef: { resourceName: `${name}/attachments/1` },
      },
    ],
  });

  test("connecting Chat links to the existing user by Google account id, never by email", async () => {
    const { t, userId } = await setup();
    await t.run((ctx) => ctx.db.insert("authAccounts", { userId, provider: "google", providerAccountId: "sub-1" }));
    const scopes = ["openid", GMAIL_SCOPE, ...CHAT_SCOPES];
    const id = await t.run((ctx) =>
      upsertGoogleUser(ctx, {
        existingUserId: null,
        profile: { email: "me@example.com", googleSub: "sub-1", encryptedGmailToken: "chat.token", scopes },
      }),
    );
    expect(id).toBe(userId);
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(JSON.stringify(user)).not.toContain("sub-1");
    expect(JSON.stringify(user)).not.toContain("chat.messages");
    const account = await t.run((ctx) =>
      ctx.db.query("gmailAccounts").withIndex("by_user", (q) => q.eq("userId", userId)).unique(),
    );
    expect(account).toMatchObject({ encryptedRefreshToken: "chat.token", scopes });

    // Same email, different Google account: a new user.
    const other = await t.run((ctx) =>
      upsertGoogleUser(ctx, { existingUserId: null, profile: { email: "me@example.com", googleSub: "sub-2" } }),
    );
    expect(other).not.toBe(userId);
  });

  test("Chat scans need Chat access and a date-only filter", async () => {
    const { t, userId, asUser } = await setup();
    await connect(t, userId);
    await expect(asUser.mutation(api.scans.start, { query: "", extensions: [], source: "chat" })).rejects.toThrow(
      "CHAT_NOT_CONNECTED",
    );
    await t.run(async (ctx) => {
      const account = await ctx.db.query("gmailAccounts").first();
      await ctx.db.patch(account!._id, { scopes: [GMAIL_SCOPE, ...CHAT_SCOPES] });
    });
    expect((await asUser.query(api.gmail.status, {}))?.connected && "ok").toBe("ok");
    await expect(
      asUser.mutation(api.scans.start, { query: "", chatFilter: "from:bob", extensions: [], source: "chat" }),
    ).rejects.toThrow("only filter by date");
    const scanId = await asUser.mutation(api.scans.start, {
      query: "",
      chatFilter: 'createTime > "2026-01-01T00:00:00.000Z" AND createTime < "2026-02-01T00:00:00.000Z"',
      extensions: [],
      source: "chat",
    });
    expect(await asUser.query(api.scans.get, { scanId })).toMatchObject({ source: "chat", status: "running" });
  });

  test("a Chat scan walks every space and page, keeping uploads and counting Drive files", async () => {
    const { t, userId, asUser } = await setup();
    await connectChat(t, userId);
    const calls = stubGoogle({
      "/v1/spaces": () =>
        Response.json({
          spaces: [
            { name: "spaces/A", displayName: "Design", spaceType: "SPACE" },
            { name: "spaces/B", spaceType: "DIRECT_MESSAGE" },
          ],
        }),
      "/v1/spaces/A/messages": () =>
        Response.json({
          messages: [upload("spaces/A/messages/1", "a.pdf"), { name: "spaces/A/messages/2" }],
          nextPageToken: "p2",
        }),
      "/v1/spaces/A/messages?p2": () =>
        Response.json({
          messages: [
            {
              name: "spaces/A/messages/3",
              attachment: [{ contentName: "Doc", source: "DRIVE_FILE", driveDataRef: { driveFileId: "d" } }],
            },
          ],
        }),
      "/v1/spaces/B/messages": () =>
        Response.json({ messages: [upload("spaces/B/messages/1", "b.txt"), upload("spaces/B/messages/2", "c.pdf")] }),
    });
    const scanId = await asUser.mutation(api.scans.start, { query: "", extensions: ["pdf"], source: "chat" });
    await t.finishAllScheduledFunctions(jest.runAllTimers);

    expect(calls.filter((c) => c.startsWith("/v1"))).toEqual([
      "/v1/spaces",
      "/v1/spaces/A/messages",
      "/v1/spaces/A/messages?p2",
      "/v1/spaces/B/messages",
    ]);
    // One refresh to list spaces, one for A's first page, one for A's second page plus all of B.
    expect(calls.filter((c) => c === "/token")).toHaveLength(3);
    const scan = await asUser.query(api.scans.get, { scanId });
    expect(scan).toMatchObject({
      status: "done",
      messagesScanned: 5,
      attachmentsFound: 2,
      driveFilesSkipped: 1,
      spaceCount: 2,
    });
    expect("spaces" in scan).toBe(false);
    const rows = await asUser.query(api.attachments.allForScan, { scanId, includeInline: false });
    expect(rows.map((r) => r.filename).sort()).toEqual(["a.pdf", "c.pdf"]);
    const all = await t.run((ctx) => ctx.db.query("attachments").collect());
    expect(all.map((r) => r.from).sort()).toEqual(["Design", "Direct message"]);
    expect(all.every((r) => r.source === "chat")).toBe(true);
  });

  const twoSpaces = () =>
    Response.json({
      spaces: [
        { name: "spaces/A", displayName: "Design", spaceType: "SPACE" },
        { name: "spaces/B", spaceType: "DIRECT_MESSAGE" },
      ],
    });

  test("chat types and picked chats limit which spaces are read", async () => {
    const { t, userId, asUser } = await setup();
    await connectChat(t, userId);
    const calls = stubGoogle({
      "/v1/spaces": twoSpaces,
      "/v1/spaces/A/messages": () => Response.json({}),
      "/v1/spaces/B/messages": () => Response.json({}),
    });
    await asUser.mutation(api.scans.start, {
      query: "",
      extensions: [],
      source: "chat",
      chatSpaceTypes: ["DIRECT_MESSAGE"],
    });
    await t.finishAllScheduledFunctions(jest.runAllTimers);
    expect(calls.filter((c) => c.includes("/messages"))).toEqual(["/v1/spaces/B/messages"]);

    calls.length = 0;
    // Picked chats win over types.
    await asUser.mutation(api.scans.start, {
      query: "",
      extensions: [],
      source: "chat",
      chatSpaceTypes: ["DIRECT_MESSAGE"],
      chatSpaceNames: ["spaces/A"],
    });
    await t.finishAllScheduledFunctions(jest.runAllTimers);
    expect(calls.filter((c) => c.includes("/messages"))).toEqual(["/v1/spaces/A/messages"]);

    await expect(
      asUser.mutation(api.scans.start, { query: "", extensions: [], source: "chat", chatSpaceNames: ["../x"] }),
    ).rejects.toThrow("Too many chats picked");
  });

  test("combined Gmail and Chat scans cannot send Gmail searches through Convex", async () => {
    const { asUser } = await setup();
    await expect(asUser.mutation(api.scans.start, { query: "", extensions: [], source: "both" })).rejects.toThrow(
      "Gmail searches now run locally in your browser",
    );
  });

  test("Chat is refused on the server while it's switched off", async () => {
    const { t, userId, asUser } = await setup();
    await connectChat(t, userId);
    process.env.GOOGLE_CHAT = "";
    await expect(asUser.mutation(api.scans.start, { query: "", extensions: [], source: "chat" })).rejects.toThrow(
      "CHAT_UNAVAILABLE",
    );
    await expect(asUser.action(api.chat.listChatSpaces, {})).rejects.toThrow("CHAT_UNAVAILABLE");
    expect(await asUser.query(api.gmail.status, {})).toMatchObject({ chatConnected: false });
  });

  test("Gmail scans stay local; the Chat filter has a length cap", async () => {
    const { t, userId, asUser } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("gmailAccounts", {
        userId,
        email: "me@work.com",
        encryptedRefreshToken: "x.y",
        status: "active",
        connectedAt: Date.now(),
        scopes: CHAT_SCOPES,
      }),
    );
    await expect(asUser.mutation(api.scans.start, { query: "", extensions: [] })).rejects.toThrow(
      "Gmail searches now run locally in your browser",
    );
    const long = Array(10).fill('createTime > "2026-01-01T00:00:00.000Z"').join(" AND ");
    await expect(
      asUser.mutation(api.scans.start, { query: "", chatFilter: long, extensions: [], source: "chat" }),
    ).rejects.toThrow("only filter by date");
  });

  test("Google's error text is logged, not shown; a missing scope fails instead of skipping chats", async () => {
    const { t, userId, asUser } = await setup();
    await connectChat(t, userId);
    stubGoogle({
      "/v1/spaces": twoSpaces,
      "/v1/spaces/A/messages": () =>
        new Response('{"error":{"details":[{"reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}],"secret":"internal"}}', {
          status: 403,
        }),
    });
    const scanId = await asUser.mutation(api.scans.start, { query: "", extensions: [], source: "chat" });
    await t.finishAllScheduledFunctions(jest.runAllTimers);
    const scan = await asUser.query(api.scans.get, { scanId });
    expect(scan.status).toBe("error");
    expect(scan.error).toContain("403");
    expect(scan.error).not.toContain("internal");
  });

  test("combined Gmail and Chat scans are refused before calling Google from Convex", async () => {
    const { asUser } = await setup();
    await expect(asUser.mutation(api.scans.start, { query: "", extensions: [], source: "both" })).rejects.toThrow(
      "Gmail searches now run locally in your browser",
    );
  });

  test("accounts without Chat (personal Gmail, Chat turned off) get a friendly error", async () => {
    const { t, userId, asUser } = await setup();
    await connectChat(t, userId);
    stubGoogle({ "/v1/spaces": () => new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 }) });
    const scanId = await asUser.mutation(api.scans.start, { query: "", extensions: [], source: "chat" });
    await t.finishAllScheduledFunctions(jest.runAllTimers);
    expect(await asUser.query(api.scans.get, { scanId })).toMatchObject({
      status: "error",
      error: "CHAT_UNAVAILABLE",
    });
  });

  test("Chat scans stop at the message limit", async () => {
    const { t, userId } = await setup();
    const scanId = await t.run((ctx) =>
      ctx.db.insert("scans", {
        userId,
        source: "chat",
        query: "",
        extensions: [],
        status: "running",
        messagesScanned: MAX_MESSAGES_PER_SCAN - 10,
        attachmentsFound: 0,
        inlineFound: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        spaces: [
          { name: "spaces/A", displayName: "A" },
          { name: "spaces/B", displayName: "B" },
        ],
        spaceIndex: 0,
      }),
    );
    await t.mutation(internal.scans.recordPage, { scanId, phase: "chat", attachments: [], messagesScanned: 50 });
    expect(await t.run((ctx) => ctx.db.get(scanId))).toMatchObject({
      status: "done",
      limitReached: true,
      spaceIndex: 0,
    });
  });
});
