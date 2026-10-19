import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, type QueryCtx, query } from "./_generated/server";
import { accessTokenForUser } from "./gmail";
import { getMessage, listMessages, mapLimit } from "./gmailApi";
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

export function withAttachmentFilter(query: string): string {
  const q = query.trim();
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
    const account = await ctx.db
      .query("gmailAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!account) throw new ConvexError("GMAIL_NOT_CONNECTED");
    if (account.status === "expired") throw new ConvexError("GMAIL_EXPIRED");

    // Each user keeps only their latest scan; older ones are stopped and cleaned up.
    for (const old of await ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) {
      if (old.status === "running") await ctx.db.patch(old._id, { status: "cancelled" });
      await ctx.scheduler.runAfter(0, internal.scans.cleanup, { scanId: old._id });
    }

    const scanId = await ctx.db.insert("scans", {
      userId,
      query: withAttachmentFilter(args.query),
      extensions: args.extensions.map((e) => e.toLowerCase().replace(/^\./, "")),
      status: "running",
      messagesScanned: 0,
      attachmentsFound: 0,
      inlineFound: 0,
      createdAt: Date.now(),
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
      const messages = await mapLimit(ids, MESSAGE_CONCURRENCY, (id) => getMessage(accessToken, id));
      const attachments: AttachmentMeta[] = messages
        .flatMap(extractAttachments)
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
    for (const a of attachments) {
      await ctx.db.insert("attachments", { ...a, scanId, userId: scan.userId });
    }
    const inline = attachments.filter((a) => a.isInline).length;
    await ctx.db.patch(scanId, {
      messagesScanned: scan.messagesScanned + messagesScanned,
      attachmentsFound: scan.attachmentsFound + attachments.length - inline,
      inlineFound: scan.inlineFound + inline,
      status: nextPageToken ? "running" : "done",
    });
    if (nextPageToken) {
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
