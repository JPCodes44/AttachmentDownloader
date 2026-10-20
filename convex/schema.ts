import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const chatSpaceType = v.union(v.literal("SPACE"), v.literal("GROUP_CHAT"), v.literal("DIRECT_MESSAGE"));

export default defineSchema({
  ...authTables,

  // One Gmail connection per user, written at Google sign-in (convex/auth.ts).
  // Only internal functions read this table.
  gmailAccounts: defineTable({
    userId: v.id("users"),
    email: v.string(),
    encryptedRefreshToken: v.string(),
    status: v.union(v.literal("active"), v.literal("expired")),
    connectedAt: v.number(),
    // OAuth scopes the stored token was granted. Missing on older rows, which are Gmail only.
    scopes: v.optional(v.array(v.string())),
  }).index("by_user", ["userId"]),

  scans: defineTable({
    userId: v.id("users"),
    // Missing on older rows, which are Gmail scans. "both" reads Gmail first, then Chat.
    source: v.optional(v.union(v.literal("gmail"), v.literal("chat"), v.literal("both"))),
    // The Gmail search; for Chat-only scans, the Chat filter (shown to the user).
    query: v.string(),
    // Chat only: the messages.list createTime filter, and which spaces to read.
    chatFilter: v.optional(v.string()),
    chatSpaceTypes: v.optional(v.array(chatSpaceType)),
    chatSpaceNames: v.optional(v.array(v.string())),
    // Lowercase file extensions to keep; empty means keep every type.
    extensions: v.array(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("done"),
      v.literal("error"),
      v.literal("cancelled"),
    ),
    messagesScanned: v.number(),
    attachmentsFound: v.number(),
    inlineFound: v.number(),
    error: v.optional(v.string()),
    // Stopped early at MAX_MESSAGES_PER_SCAN or MAX_ATTACHMENTS_PER_SCAN.
    limitReached: v.optional(v.boolean()),
    createdAt: v.number(),
    // Last progress; the stale-scan cron fails running scans that stop moving.
    updatedAt: v.optional(v.number()),
    // Chat only: whether the token can read Drive. Without it, files shared from
    // Drive are only counted in driveFilesSkipped.
    driveAccess: v.optional(v.boolean()),
    driveFilesSkipped: v.optional(v.number()),
    // The Chat share of messagesScanned and attachmentsFound, for "both" scans.
    chatMessagesScanned: v.optional(v.number()),
    chatFound: v.optional(v.number()),
    // Chat only: the spaces to walk (capped at MAX_CHAT_SPACES) and which one is next.
    spaces: v.optional(v.array(v.object({ name: v.string(), displayName: v.string() }))),
    spaceIndex: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),

  // Metadata only. Bytes are downloaded by the browser straight from Gmail.
  attachments: defineTable({
    scanId: v.id("scans"),
    userId: v.id("users"),
    // Missing on older rows, which are Gmail. For Chat, messageId is the message
    // name and attachmentId the media resource name.
    source: v.optional(v.union(v.literal("gmail"), v.literal("chat"))),
    messageId: v.string(),
    attachmentId: v.string(),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    from: v.string(),
    subject: v.string(),
    date: v.number(),
    isInline: v.boolean(),
  })
    .index("by_scan", ["scanId"])
    .index("by_scan_date", ["scanId", "date"])
    .index("by_scan_inline_date", ["scanId", "isInline", "date"])
    .index("by_scan_source_date", ["scanId", "source", "date"])
    .index("by_scan_source_inline_date", ["scanId", "source", "isInline", "date"]),
});
