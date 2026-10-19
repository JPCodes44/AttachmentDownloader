import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  type ActionCtx,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { decrypt, randomToken } from "./crypto";
import {
  buildConsentUrl,
  GmailExpiredError,
  listLabels as fetchLabels,
  refreshAccessToken,
  revokeToken,
} from "./gmailApi";

const STATE_TTL_MS = 10 * 60 * 1000;
// System labels that work as `label:<id>` in Gmail search.
const SEARCHABLE_SYSTEM_LABELS = new Set(["INBOX", "SENT", "STARRED", "IMPORTANT"]);

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
    return { connected: true as const, email: account.email, status: account.status };
  },
});

export const createConnectUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first");
    const state = randomToken();
    await ctx.db.insert("oauthStates", { state, userId, expiresAt: Date.now() + STATE_TTL_MS });
    return buildConsentUrl(state);
  },
});

// Returns the user the ticket was issued to, and burns it so it can't be replayed.
export const consumeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    return row.expiresAt > Date.now() ? row.userId : null;
  },
});

export const saveAccount = internalMutation({
  args: { userId: v.id("users"), email: v.string(), encryptedRefreshToken: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("gmailAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    const fields = { ...args, status: "active" as const, connectedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, fields);
    else await ctx.db.insert("gmailAccounts", fields);
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

export const deleteAccount = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const account = await ctx.db
      .query("gmailAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (account) await ctx.db.delete(account._id);
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

async function requireUser(ctx: ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first");
  return userId;
}

// A short-lived (1 hour) read-only token so the browser can download file bytes
// straight from Gmail. The refresh token itself never leaves Convex.
export const getAccessToken = action({
  args: {},
  handler: async (ctx): Promise<AccessToken> => accessTokenForUser(ctx, await requireUser(ctx)),
});

export const listLabels = action({
  args: {},
  handler: async (ctx): Promise<{ id: string; name: string; system: boolean }[]> => {
    const { accessToken } = await accessTokenForUser(ctx, await requireUser(ctx));
    const { labels = [] } = await fetchLabels(accessToken);
    return labels
      .filter((l) => l.type !== "system" || SEARCHABLE_SYSTEM_LABELS.has(l.id))
      .map((l) => ({ id: l.id, name: l.name, system: l.type === "system" }))
      .sort((a, b) => Number(a.system) - Number(b.system) || a.name.localeCompare(b.name));
  },
});

export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const userId = await requireUser(ctx);
    const account = await ctx.runQuery(internal.gmail.getAccount, { userId });
    if (!account) return;
    try {
      await revokeToken(await decrypt(account.encryptedRefreshToken));
    } catch {
      // Already revoked or undecryptable: deleting the row is what matters.
    }
    await ctx.runMutation(internal.gmail.deleteAccount, { userId });
  },
});
