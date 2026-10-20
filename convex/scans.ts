import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server";
import { ChatNotAvailableError, chatEnabled, DRIVE_SCOPE, listSpaceMessages, listSpaces } from "./chatApi";
import { type ChatSpace, extractChatAttachments, spaceLabel } from "./chatParts";
import { accessTokenForUser, hasChatScopes } from "./gmail";
import { GMAIL_SCOPE, GoogleApiError, getMessage, listMessages, mapLimit } from "./gmailApi";
import {
  MAX_ATTACHMENTS_PER_SCAN,
  MAX_CHAT_SPACES,
  MAX_EXTENSION_LENGTH,
  MAX_EXTENSIONS,
  MAX_MESSAGES_PER_SCAN,
  MAX_QUERY_LENGTH,
  rateLimiter,
} from "./limits";
import { type AttachmentMeta, extractAttachments } from "./parts";
import { chatSpaceType } from "./schema";

const MESSAGE_CONCURRENCY = 8;

const attachmentValidator = v.object({
  messageId: v.string(),
  attachmentId: v.string(),
  filename: v.string(),
  mimeType: v.string(),
  size: v.number(),
  from: v.string(),
  subject: v.string(),
  date: v.number(),
  isInline: v.boolean(),
});

// Gmail ANDs space-separated terms, so has:attachment anywhere at the top level
// filters everything. OR, {} or () could put it inside a branch, so wrap those.
export function withAttachmentFilter(query: string): string {
  const q = query.trim();
  if (/\bOR\b|[{}()]/.test(q)) return `(${q}) has:attachment`;
  return /\bhas:attachment\b/.test(q) ? q : `${q} has:attachment`.trim();
}

const sourceValidator = v.union(v.literal("gmail"), v.literal("chat"));
const MAX_CHAT_SPACE_NAMES = 500;
const MAX_CHAT_FILTER_LENGTH = 200;
// One chatScanPage run reads spaces until it has this many messages, spaces or seconds.
const CHAT_RUN_MESSAGES = 1_000;
const CHAT_RUN_SPACES = 50;
const CHAT_RUN_MS = 60_000;
// recordPage takes at most 8,192 rows; a 200-message page can't add more than ~2,000 more.
const CHAT_RUN_ATTACHMENTS = 4_000;
const SPACE_NAME = /^spaces\/[\w-]{1,100}$/;

// Chat can only filter on createTime, e.g. createTime > "2026-01-01T00:00:00.000Z" AND createTime < "…".
const CHAT_FILTER = /^(createTime [<>] "[0-9TZ:.+-]+"( AND (?=c))?)*$/;

export function matchesExtensions(filename: string, extensions: string[]): boolean {
  if (extensions.length === 0) return true;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return extensions.includes(ext);
}

export async function getOwnScan(ctx: QueryCtx, scanId: Id<"scans">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first");
  const scan = await ctx.db.get(scanId);
  if (!scan || scan.userId !== userId) throw new ConvexError("Scan not found");
  return scan;
}

export const start = mutation({
  args: {
    query: v.string(),
    extensions: v.array(v.string()),
    source: v.optional(v.union(v.literal("gmail"), v.literal("chat"), v.literal("both"))),
    // Chat only: a createTime filter, and optionally which kinds of chat or which chats to read.
    chatFilter: v.optional(v.string()),
    chatSpaceTypes: v.optional(v.array(chatSpaceType)),
    chatSpaceNames: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const source = args.source ?? "gmail";
    const withChat = source !== "gmail";
    const chatFilter = (args.chatFilter ?? "").trim();
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first");
    if (args.query.length > MAX_QUERY_LENGTH) throw new ConvexError("Search is too long");
    if (args.extensions.length > MAX_EXTENSIONS || args.extensions.some((e) => e.length > MAX_EXTENSION_LENGTH)) {
      throw new ConvexError("Too many file types");
    }
    const account = await ctx.db
      .query("gmailAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!account) throw new ConvexError("GMAIL_NOT_CONNECTED");
    if (account.status === "expired") throw new ConvexError("GMAIL_EXPIRED");
    // Rows without scopes predate Chat and are Gmail only.
    if (source !== "chat" && account.scopes && !account.scopes.includes(GMAIL_SCOPE)) {
      throw new ConvexError("GMAIL_NOT_CONNECTED");
    }
    if (withChat) {
      if (!chatEnabled()) throw new ConvexError("CHAT_UNAVAILABLE");
      if (!hasChatScopes(account.scopes)) throw new ConvexError("CHAT_NOT_CONNECTED");
      if (chatFilter.length > MAX_CHAT_FILTER_LENGTH || !CHAT_FILTER.test(chatFilter)) {
        throw new ConvexError("Chat searches can only filter by date");
      }
      const names = args.chatSpaceNames ?? [];
      if (names.length > MAX_CHAT_SPACE_NAMES || names.some((n) => !SPACE_NAME.test(n))) {
        throw new ConvexError("Too many chats picked");
      }
    }
    const { ok } = await rateLimiter.limit(ctx, "startScan", { key: userId });
    if (!ok) throw new ConvexError("Too many searches. Wait a few minutes and try again.");

    // Each user keeps only their latest scan; older ones are stopped and cleaned up.
    await deleteScans(ctx, userId);

    const scanId = await ctx.db.insert("scans", {
      userId,
      source,
      query: source === "chat" ? chatFilter : withAttachmentFilter(args.query),
      extensions: args.extensions.map((e) => e.toLowerCase().replace(/^\./, "")),
      status: "running",
      messagesScanned: 0,
      attachmentsFound: 0,
      inlineFound: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(withChat
        ? {
            chatFilter,
            chatSpaceTypes: args.chatSpaceTypes?.length ? args.chatSpaceTypes : undefined,
            chatSpaceNames: args.chatSpaceNames?.length ? args.chatSpaceNames : undefined,
            driveAccess: !!account.scopes?.includes(DRIVE_SCOPE),
            driveFilesSkipped: 0,
            chatMessagesScanned: 0,
            chatFound: 0,
          }
        : {}),
    });
    await ctx.scheduler.runAfter(0, source === "chat" ? internal.scans.chatListSpaces : internal.scans.scanPage, {
      scanId,
    });
    return scanId;
  },
});

// The Chat space lists are the scan's own bookkeeping: clients get a count, not the lists, on every update.
function forClient<T extends { spaces?: unknown[]; chatSpaceNames?: unknown[] }>(
  scan: T,
): Omit<T, "spaces" | "chatSpaceNames"> & { spaceCount?: number } {
  const { spaces, chatSpaceNames: _, ...rest } = scan;
  return spaces ? { ...rest, spaceCount: spaces.length } : rest;
}

export const get = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => forClient(await getOwnScan(ctx, scanId)),
});

export const latest = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const scan = await ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    return scan && forClient(scan);
  },
});

export const cancel = mutation({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await getOwnScan(ctx, scanId);
    if (scan.status === "running") await ctx.db.patch(scanId, { status: "cancelled" });
  },
});

export const getInternal = internalQuery({
  args: { scanId: v.id("scans") },
  handler: (ctx, { scanId }) => ctx.db.get(scanId),
});

// One page of up to 100 emails per run keeps each action short and lets the UI show progress.
export const scanPage = internalAction({
  args: { scanId: v.id("scans"), pageToken: v.optional(v.string()) },
  handler: async (ctx, { scanId, pageToken }): Promise<void> => {
    const scan = await ctx.runQuery(internal.scans.getInternal, { scanId });
    if (!scan || scan.status !== "running") return;
    try {
      const { accessToken } = await accessTokenForUser(ctx, scan.userId);
      const page = await listMessages(accessToken, scan.query, pageToken);
      const ids = (page.messages ?? []).map((m) => m.id);
      // Extract inside each worker so only a few full messages are in memory at once.
      const perMessage = await mapLimit(ids, MESSAGE_CONCURRENCY, async (id) => {
        const message = await getMessage(accessToken, id);
        return message ? extractAttachments(message) : [];
      });
      const attachments: AttachmentMeta[] = perMessage
        .flat()
        .filter((a) => matchesExtensions(a.filename, scan.extensions));
      await ctx.runMutation(internal.scans.recordPage, {
        scanId,
        phase: "gmail",
        attachments,
        messagesScanned: ids.length,
        nextPageToken: page.nextPageToken,
      });
    } catch (err) {
      await ctx.runMutation(internal.scans.recordError, { scanId, error: scanError(err) });
    }
  },
});

// Error codes the UI turns into friendly messages. Google's own error text stays in the logs.
function scanError(err: unknown): string {
  if (err instanceof ConvexError && err.data === "GMAIL_EXPIRED") return "GMAIL_EXPIRED";
  if (err instanceof ChatNotAvailableError) return "CHAT_UNAVAILABLE";
  if (err instanceof GoogleApiError) {
    console.error(err.message);
    return `Google returned an error (${err.status}). Try again in a few minutes.`;
  }
  return err instanceof Error ? err.message : String(err);
}

// A Chat scan first lists the user's spaces (DMs, group chats, spaces), keeps the
// kinds or the exact chats asked for, then walks them one by one.
export const chatListSpaces = internalAction({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }): Promise<void> => {
    const scan = await ctx.runQuery(internal.scans.getInternal, { scanId });
    if (!scan || scan.status !== "running") return;
    try {
      const { accessToken } = await accessTokenForUser(ctx, scan.userId);
      const { chatSpaceTypes: types, chatSpaceNames: names } = scan;
      // Picked chats win over chat types.
      const wanted = (s: ChatSpace) =>
        names ? names.includes(s.name) : !types || types.some((t) => t === s.spaceType);
      const spaces: { name: string; displayName: string }[] = [];
      let pageToken: string | undefined;
      do {
        const page = await listSpaces(accessToken, pageToken);
        for (const s of page.spaces ?? []) {
          if (wanted(s)) spaces.push({ name: s.name, displayName: spaceLabel(s) });
        }
        pageToken = page.nextPageToken;
      } while (pageToken && spaces.length < MAX_CHAT_SPACES && !(names && spaces.length === names.length));
      await ctx.runMutation(internal.scans.saveSpaces, {
        scanId,
        spaces: spaces.slice(0, MAX_CHAT_SPACES),
        limitReached: spaces.length > MAX_CHAT_SPACES || (!!pageToken && spaces.length >= MAX_CHAT_SPACES),
      });
    } catch (err) {
      // Searching both: keep the Gmail results and just say Chat wasn't available.
      if (scan.source === "both" && err instanceof ChatNotAvailableError) {
        await ctx.runMutation(internal.scans.saveSpaces, {
          scanId,
          spaces: [],
          limitReached: false,
          error: "CHAT_UNAVAILABLE",
        });
      } else {
        await ctx.runMutation(internal.scans.recordError, { scanId, error: scanError(err) });
      }
    }
  },
});

export const saveSpaces = internalMutation({
  args: {
    scanId: v.id("scans"),
    spaces: v.array(v.object({ name: v.string(), displayName: v.string() })),
    limitReached: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { scanId, spaces, limitReached, error }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.status !== "running") return;
    await ctx.db.patch(scanId, {
      spaces,
      spaceIndex: 0,
      status: spaces.length > 0 ? "running" : "done",
      ...(limitReached ? { limitReached: true } : {}),
      ...(error ? { error } : {}),
      updatedAt: Date.now(),
    });
    if (spaces.length > 0) await ctx.scheduler.runAfter(0, internal.scans.chatScanPage, { scanId });
  },
});

// Reads the current space from pageToken, then the spaces after it, until a space has
// more pages or a run budget is used up. Short and empty chats share one run (and one
// token refresh) instead of costing one each.
export const chatScanPage = internalAction({
  args: { scanId: v.id("scans"), pageToken: v.optional(v.string()) },
  handler: async (ctx, { scanId, pageToken }): Promise<void> => {
    const scan = await ctx.runQuery(internal.scans.getInternal, { scanId });
    if (!scan || scan.status !== "running") return;
    const spaces = scan.spaces ?? [];
    let index = scan.spaceIndex ?? 0;
    if (!spaces[index]) return;
    try {
      const { accessToken } = await accessTokenForUser(ctx, scan.userId);
      const started = Date.now();
      const attachments: AttachmentMeta[] = [];
      let messagesScanned = 0;
      let driveFilesSkipped = 0;
      let spacesRead = 0;
      let nextPageToken = pageToken;
      for (;;) {
        const space = spaces[index]!;
        let page;
        try {
          page = await listSpaceMessages(accessToken, space.name, scan.chatFilter ?? "", nextPageToken);
        } catch (err) {
          // Left the space, or it was deleted, since it was listed: skip it. A missing
          // scope is a 403 too, but must fail the scan rather than skip every space.
          const gone =
            err instanceof GoogleApiError &&
            (err.status === 404 ||
              (err.status === 403 && !/SCOPE_INSUFFICIENT|rateLimitExceeded|RATE_LIMIT/.test(err.message)));
          if (!gone) throw err;
          page = {};
        }
        for (const message of page.messages ?? []) {
          const found = extractChatAttachments(message, space.displayName, scan.driveAccess ?? false);
          attachments.push(...found.attachments.filter((a) => matchesExtensions(a.filename, scan.extensions)));
          driveFilesSkipped += found.driveFiles;
        }
        messagesScanned += page.messages?.length ?? 0;
        nextPageToken = page.nextPageToken;
        if (nextPageToken) break;
        index++;
        spacesRead++;
        if (
          index >= spaces.length ||
          messagesScanned >= CHAT_RUN_MESSAGES ||
          attachments.length >= CHAT_RUN_ATTACHMENTS ||
          spacesRead >= CHAT_RUN_SPACES ||
          Date.now() - started > CHAT_RUN_MS
        ) {
          break;
        }
      }
      await ctx.runMutation(internal.scans.recordPage, {
        scanId,
        phase: "chat",
        attachments,
        messagesScanned,
        nextPageToken,
        nextSpaceIndex: index,
        driveFilesSkipped,
      });
    } catch (err) {
      await ctx.runMutation(internal.scans.recordError, { scanId, error: scanError(err) });
    }
  },
});

export const recordPage = internalMutation({
  args: {
    scanId: v.id("scans"),
    // Which part of the scan this page came from; Gmail when missing.
    phase: v.optional(sourceValidator),
    attachments: v.array(attachmentValidator),
    messagesScanned: v.number(),
    nextPageToken: v.optional(v.string()),
    // Chat: the space to read next (the one nextPageToken belongs to, if any).
    nextSpaceIndex: v.optional(v.number()),
    driveFilesSkipped: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { scanId, phase = "gmail", attachments, messagesScanned, nextPageToken, nextSpaceIndex, driveFilesSkipped },
  ) => {
    const scan = await ctx.db.get(scanId);
    // Cancelled while this page was in flight: drop the results.
    if (!scan || scan.status !== "running") return;
    const room = MAX_ATTACHMENTS_PER_SCAN - scan.attachmentsFound - scan.inlineFound;
    const kept = attachments.slice(0, Math.max(0, room));
    for (const a of kept) {
      await ctx.db.insert("attachments", { ...a, source: phase, scanId, userId: scan.userId });
    }
    const inline = kept.filter((a) => a.isInline).length;
    const scanned = scan.messagesScanned + messagesScanned;
    const limitReached =
      kept.length < attachments.length ||
      scan.attachmentsFound + scan.inlineFound + kept.length >= MAX_ATTACHMENTS_PER_SCAN ||
      scanned >= MAX_MESSAGES_PER_SCAN;
    // Chat moves on to the next space when the current one runs out of pages;
    // a scan of both moves on to Chat when Gmail runs out.
    const chat = phase === "chat";
    const spaceIndex = scan.spaceIndex ?? 0;
    const nextSpace = nextSpaceIndex ?? (nextPageToken ? spaceIndex : spaceIndex + 1);
    const toChat = !chat && !nextPageToken && scan.source === "both";
    const unread = chat ? nextSpace < (scan.spaces?.length ?? 0) : !!nextPageToken || toChat;
    const more = unread && !limitReached;
    await ctx.db.patch(scanId, {
      messagesScanned: scanned,
      attachmentsFound: scan.attachmentsFound + kept.length - inline,
      inlineFound: scan.inlineFound + inline,
      status: more ? "running" : "done",
      ...(limitReached && unread ? { limitReached: true } : {}),
      ...(driveFilesSkipped ? { driveFilesSkipped: (scan.driveFilesSkipped ?? 0) + driveFilesSkipped } : {}),
      ...(chat
        ? {
            chatMessagesScanned: (scan.chatMessagesScanned ?? 0) + messagesScanned,
            chatFound: (scan.chatFound ?? 0) + kept.length,
          }
        : {}),
      ...(chat && more ? { spaceIndex: nextSpace } : {}),
      updatedAt: Date.now(),
    });
    if (!more) return;
    if (toChat) await ctx.scheduler.runAfter(0, internal.scans.chatListSpaces, { scanId });
    else {
      await ctx.scheduler.runAfter(0, chat ? internal.scans.chatScanPage : internal.scans.scanPage, {
        scanId,
        pageToken: nextPageToken,
      });
    }
  },
});

export const recordError = internalMutation({
  args: { scanId: v.id("scans"), error: v.string() },
  handler: async (ctx, { scanId, error }) => {
    const scan = await ctx.db.get(scanId);
    if (scan?.status === "running") await ctx.db.patch(scanId, { status: "error", error });
  },
});

// Stops every scan the user has and schedules deletion of its rows.
export async function deleteScans(ctx: MutationCtx, userId: Id<"users">) {
  for (const old of await ctx.db
    .query("scans")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) {
    if (old.status === "running") await ctx.db.patch(old._id, { status: "cancelled" });
    await ctx.scheduler.runAfter(0, internal.scans.cleanup, { scanId: old._id });
  }
}

// Longer than the 10-minute action limit, so a live page is never mistaken for a dead one.
export const STALE_AFTER_MS = 15 * 60 * 1000;

// A scan whose page action died (crash, out of memory, deploy) would sit at "running" forever.
export const failStaleScans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("scans")
      .withIndex("by_status_and_updatedAt", (q) =>
        q.eq("status", "running").lt("updatedAt", Date.now() - STALE_AFTER_MS),
      )
      .take(100);
    for (const scan of stale) {
      await ctx.db.patch(scan._id, { status: "error", error: "The scan stopped responding. Try again." });
    }
  },
});

export const RETAIN_SCANS_MS = 30 * 24 * 60 * 60 * 1000;

// Scan results are mailbox metadata (senders, subjects, filenames); don't keep them forever.
export const deleteOldScans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("scans")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", Date.now() - RETAIN_SCANS_MS))
      .take(100);
    for (const scan of old) {
      if (scan.status === "running") await ctx.db.patch(scan._id, { status: "cancelled" });
      await ctx.scheduler.runAfter(0, internal.scans.cleanup, { scanId: scan._id });
    }
    if (old.length === 100) await ctx.scheduler.runAfter(60_000, internal.scans.deleteOldScans, {});
  },
});

const CLEANUP_BATCH = 500;

// Deletes a scan's attachment rows in batches, then the scan itself.
export const cleanup = internalMutation({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const rows = await ctx.db
      .query("attachments")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .take(CLEANUP_BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.scans.cleanup, { scanId });
    } else if (await ctx.db.get(scanId)) {
      await ctx.db.delete(scanId);
    }
  },
});
