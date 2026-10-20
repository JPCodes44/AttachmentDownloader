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
import { accessTokenForUser } from "./gmail";
import { getMessage, listMessages, mapLimit } from "./gmailApi";
import {
  MAX_ATTACHMENTS_PER_SCAN,
  MAX_EXTENSION_LENGTH,
  MAX_EXTENSIONS,
  MAX_MESSAGES_PER_SCAN,
  MAX_QUERY_LENGTH,
  rateLimiter,
} from "./limits";
import { type AttachmentMeta, extractAttachments } from "./parts";

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
  args: { query: v.string(), extensions: v.array(v.string()) },
  handler: async (ctx, args) => {
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
    const { ok } = await rateLimiter.limit(ctx, "startScan", { key: userId });
    if (!ok) throw new ConvexError("Too many searches. Wait a few minutes and try again.");

    // Each user keeps only their latest scan; older ones are stopped and cleaned up.
    await deleteScans(ctx, userId);

    const scanId = await ctx.db.insert("scans", {
      userId,
      query: withAttachmentFilter(args.query),
      extensions: args.extensions.map((e) => e.toLowerCase().replace(/^\./, "")),
      status: "running",
      messagesScanned: 0,
      attachmentsFound: 0,
      inlineFound: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.scans.scanPage, { scanId });
    return scanId;
  },
});

export const get = query({
  args: { scanId: v.id("scans") },
  handler: (ctx, { scanId }) => getOwnScan(ctx, scanId),
});

export const latest = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
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
        attachments,
        messagesScanned: ids.length,
        nextPageToken: page.nextPageToken,
      });
    } catch (err) {
      const message =
        err instanceof ConvexError && err.data === "GMAIL_EXPIRED"
          ? "GMAIL_EXPIRED"
          : err instanceof Error
            ? err.message
            : String(err);
      await ctx.runMutation(internal.scans.recordError, { scanId, error: message });
    }
  },
});

export const recordPage = internalMutation({
  args: {
    scanId: v.id("scans"),
    attachments: v.array(attachmentValidator),
    messagesScanned: v.number(),
    nextPageToken: v.optional(v.string()),
  },
  handler: async (ctx, { scanId, attachments, messagesScanned, nextPageToken }) => {
    const scan = await ctx.db.get(scanId);
    // Cancelled while this page was in flight: drop the results.
    if (!scan || scan.status !== "running") return;
    const room = MAX_ATTACHMENTS_PER_SCAN - scan.attachmentsFound - scan.inlineFound;
    const kept = attachments.slice(0, Math.max(0, room));
    for (const a of kept) {
      await ctx.db.insert("attachments", { ...a, scanId, userId: scan.userId });
    }
    const inline = kept.filter((a) => a.isInline).length;
    const scanned = scan.messagesScanned + messagesScanned;
    const limitReached =
      kept.length < attachments.length ||
      scan.attachmentsFound + scan.inlineFound + kept.length >= MAX_ATTACHMENTS_PER_SCAN ||
      scanned >= MAX_MESSAGES_PER_SCAN;
    const more = !!nextPageToken && !limitReached;
    await ctx.db.patch(scanId, {
      messagesScanned: scanned,
      attachmentsFound: scan.attachmentsFound + kept.length - inline,
      inlineFound: scan.inlineFound + inline,
      status: more ? "running" : "done",
      ...(limitReached && nextPageToken ? { limitReached: true } : {}),
      updatedAt: Date.now(),
    });
    if (more) {
      await ctx.scheduler.runAfter(0, internal.scans.scanPage, { scanId, pageToken: nextPageToken });
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
