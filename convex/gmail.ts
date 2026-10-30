import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx, internalMutation, internalQuery, query } from "./_generated/server";
import { CHAT_SCOPES, chatEnabled, DRIVE_SCOPE } from "./chatApi";
import { decrypt } from "./crypto";
import {
  GMAIL_SCOPE,
  GmailExpiredError,
  refreshAccessToken,
  revokeToken,
} from "./gmailApi";
import { rateLimiter } from "./limits";
import { deleteScans } from "./scans";

export function hasChatScopes(scopes: string[] | undefined): boolean {
  return CHAT_SCOPES.every((s) => scopes?.includes(s));
}

// What the UI needs to know about the user's Gmail connection. Never includes tokens.
export const status = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const account = await ctx.db
      .query("gmailAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!account) return { connected: false as const };
    return {
      connected: true as const,
      email: account.email,
      status: account.status,
      chatConnected: chatEnabled() && hasChatScopes(account.scopes),
      driveConnected: !!account.scopes?.includes(DRIVE_SCOPE),
    };
  },
});

export const getAccount = internalQuery({
  args: { userId: v.id("users") },
  handler: (ctx, { userId }) =>
    ctx.db
      .query("gmailAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique(),
});

export const markExpired = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const account = await ctx.db
      .query("gmailAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (account) await ctx.db.patch(account._id, { status: "expired" });
  },
});

// Disconnecting also deletes scan results: they are Gmail data too.
export const deleteAccount = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const account = await ctx.db
      .query("gmailAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (account) await ctx.db.delete(account._id);
    await deleteScans(ctx, userId);
  },
});

// Trades the stored refresh token for a fresh access token. Marks the account
// expired when Google rejects it, so the UI can ask the user to reconnect.
export type AccessToken = { accessToken: string; expiresIn: number };

export async function accessTokenForUser(ctx: ActionCtx, userId: Id<"users">): Promise<AccessToken> {
  const account = await ctx.runQuery(internal.gmail.getAccount, { userId });
  if (!account) throw new ConvexError("GMAIL_NOT_CONNECTED");
  if (account.status === "expired") throw new ConvexError("GMAIL_EXPIRED");
  try {
    return await refreshAccessToken(await decrypt(account.encryptedRefreshToken));
  } catch (err) {
    if (err instanceof GmailExpiredError) {
      await ctx.runMutation(internal.gmail.markExpired, { userId });
      throw new ConvexError("GMAIL_EXPIRED");
    }
    throw err;
  }
}

export async function requireUser(ctx: ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first");
  return userId;
}

// Each call refreshes a token at Google, so cap how often a user can ask.
export async function limitedAccessToken(ctx: ActionCtx): Promise<AccessToken> {
  const userId = await requireUser(ctx);
  const { ok } = await rateLimiter.limit(ctx, "gmailToken", { key: userId });
  if (!ok) throw new ConvexError("Too many requests. Wait a minute and try again.");
  return accessTokenForUser(ctx, userId);
}

// Revokes the stored Gmail grant at Google, ignoring failures: deleting the row is what matters.
export async function revokeStoredToken(ctx: ActionCtx, userId: Id<"users">) {
  const account = await ctx.runQuery(internal.gmail.getAccount, { userId });
  if (!account) return;
  try {
    await revokeToken(await decrypt(account.encryptedRefreshToken));
  } catch {
    // Already revoked or undecryptable.
  }
}

// Kept as a compatibility endpoint for old clients. Gmail tokens are no longer
// issued to browser clients by Convex.
export const getAccessToken = action({
  args: {},
  handler: async (): Promise<AccessToken> => {
    throw new ConvexError("Gmail now connects in your browser. Reopen the app to connect Gmail locally.");
  },
});

// One-time cleanup when a user opens the browser-only Gmail flow. Old versions
// stored a Gmail refresh token and search results in Convex; revoke and remove
// those records. Chat-only grants created by the new provider are preserved.
export const migrateToLocal = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const userId = await requireUser(ctx);
    const account = await ctx.runQuery(internal.gmail.getAccount, { userId });
    if (!account || (account.scopes && !account.scopes.includes(GMAIL_SCOPE))) return;
    await revokeStoredToken(ctx, userId);
    await ctx.runMutation(internal.gmail.deleteAccount, { userId });
  },
});

export const listLabels = action({
  args: {},
  handler: async (): Promise<{ id: string; name: string; system: boolean }[]> => {
    throw new ConvexError("Gmail labels are now loaded directly in your browser.");
  },
});

export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const userId = await requireUser(ctx);
    await revokeStoredToken(ctx, userId);
    await ctx.runMutation(internal.gmail.deleteAccount, { userId });
  },
});
