import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { MAX_ATTACHMENTS_PER_SCAN } from "./limits";
import { getOwnScan } from "./scans";

export const list = query({
  args: { scanId: v.id("scans"), includeInline: v.boolean(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { scanId, includeInline, paginationOpts }) => {
    await getOwnScan(ctx, scanId);
    const q = includeInline
      ? ctx.db.query("attachments").withIndex("by_scan_date", (q) => q.eq("scanId", scanId))
      : ctx.db
          .query("attachments")
          .withIndex("by_scan_inline_date", (q) => q.eq("scanId", scanId).eq("isInline", false));
    return q.order("desc").paginate(paginationOpts);
  },
});

// Everything needed to download every attachment in a scan ("Select all").
export const allForScan = query({
  args: { scanId: v.id("scans"), includeInline: v.boolean() },
  handler: async (ctx, { scanId, includeInline }) => {
    await getOwnScan(ctx, scanId);
    // A scan stores at most MAX_ATTACHMENTS_PER_SCAN rows, so this stays within query limits.
    const rows = await (includeInline
      ? ctx.db.query("attachments").withIndex("by_scan", (q) => q.eq("scanId", scanId))
      : ctx.db
          .query("attachments")
          .withIndex("by_scan_inline_date", (q) => q.eq("scanId", scanId).eq("isInline", false))
    ).take(MAX_ATTACHMENTS_PER_SCAN);
    return rows.map(({ _id, messageId, attachmentId, filename, mimeType, size, date }) => ({
        _id,
        messageId,
        attachmentId,
        filename,
        mimeType,
        size,
        date,
      }));
  },
});
