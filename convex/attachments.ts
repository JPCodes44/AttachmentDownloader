import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { MAX_ATTACHMENTS_PER_SCAN } from "./limits";
import { getOwnScan } from "./scans";

// Only set on scans of both Gmail and Chat, to show one of them.
const sourceFilter = v.optional(v.union(v.literal("gmail"), v.literal("chat")));

function rowsFor(
  ctx: QueryCtx,
  scanId: Id<"scans">,
  includeInline: boolean,
  source: "gmail" | "chat" | undefined,
) {
  const rows = ctx.db.query("attachments");
  if (source) {
    return includeInline
      ? rows.withIndex("by_scan_source_date", (q) => q.eq("scanId", scanId).eq("source", source))
      : rows.withIndex("by_scan_source_inline_date", (q) =>
          q.eq("scanId", scanId).eq("source", source).eq("isInline", false),
        );
  }
  return includeInline
    ? rows.withIndex("by_scan_date", (q) => q.eq("scanId", scanId))
    : rows.withIndex("by_scan_inline_date", (q) => q.eq("scanId", scanId).eq("isInline", false));
}

export const list = query({
  args: {
    scanId: v.id("scans"),
    includeInline: v.boolean(),
    source: sourceFilter,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { scanId, includeInline, source, paginationOpts }) => {
    await getOwnScan(ctx, scanId);
    return rowsFor(ctx, scanId, includeInline, source).order("desc").paginate(paginationOpts);
  },
});

// Everything needed to download every attachment in a scan ("Select all").
export const allForScan = query({
  args: { scanId: v.id("scans"), includeInline: v.boolean(), source: sourceFilter },
  handler: async (ctx, { scanId, includeInline, source }) => {
    await getOwnScan(ctx, scanId);
    // A scan stores at most MAX_ATTACHMENTS_PER_SCAN rows, so this stays within query limits.
    const rows = await rowsFor(ctx, scanId, includeInline, source).take(MAX_ATTACHMENTS_PER_SCAN);
    return rows.map(({ _id, source, messageId, attachmentId, filename, mimeType, size, date }) => ({
      _id,
      source: source ?? ("gmail" as const),
      messageId,
      attachmentId,
      filename,
      mimeType,
      size,
      date,
    }));
  },
});
