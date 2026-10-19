import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  // One Gmail connection per user. Only internal functions read this table.
  gmailAccounts: defineTable({
    userId: v.id("users"),
    email: v.string(),
    encryptedRefreshToken: v.string(),
    status: v.union(v.literal("active"), v.literal("expired")),
    connectedAt: v.number(),
  }).index("by_user", ["userId"]),

  // One-time CSRF "state" tickets for the Gmail OAuth redirect.
  oauthStates: defineTable({
    state: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),

  scans: defineTable({
    userId: v.id("users"),
    query: v.string(),
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
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Metadata only. Bytes are downloaded by the browser straight from Gmail.
  attachments: defineTable({
    scanId: v.id("scans"),
    userId: v.id("users"),
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
    .index("by_scan_inline_date", ["scanId", "isInline", "date"]),
});
