import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";
import { requireUser, revokeStoredToken } from "./gmail";
import { deleteScans } from "./scans";

// "Delete my account": revokes Gmail access, then removes everything stored about the user.
export const deleteAccount = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const userId = await requireUser(ctx);
    await revokeStoredToken(ctx, userId);
    await ctx.runMutation(internal.account.deleteUserData, { userId });
  },
});

export const deleteUserData = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await deleteScans(ctx, userId);
    for (const row of await ctx.db
      .query("gmailAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) {
      await ctx.db.delete(row._id);
    }
    for (const account of await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect()) {
      await ctx.db.delete(account._id);
    }
    for (const session of await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect()) {
      for (const token of await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .collect()) {
        await ctx.db.delete(token._id);
      }
      await ctx.db.delete(session._id);
    }
    if (await ctx.db.get(userId)) await ctx.db.delete(userId);
  },
});
