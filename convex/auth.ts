import Google, { type GoogleProfile } from "@auth/core/providers/google";
import type { TokenSet } from "@auth/core/types";
import { convexAuth } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { CHAT_SCOPES, chatEnabled, DRIVE_SCOPE } from "./chatApi";
import { encrypt } from "./crypto";

// What profile() hands to createOrUpdateUser. The optional encrypted token is
// only used by the Chat provider; Gmail access never enters Convex Auth.
export type GoogleSignInProfile = {
  email: string;
  name?: string;
  image?: string;
  encryptedGmailToken?: string;
  // Google's account id, used to find the user when Chat is connected (see upsertGoogleUser).
  googleSub?: string;
  // Every scope the token carries, Gmail and Chat included.
  scopes?: string[];
};

// Both providers sign in to the same Google account. The default provider is
// profile-only; Gmail access is requested by the browser and never enters Convex.
const GOOGLE_PROVIDERS = ["google", "google-chat"];

async function googleProfile(google: GoogleProfile) {
  if (google.email_verified !== true) throw new Error("Google account email is not verified");
  return {
    id: google.sub,
    googleSub: google.sub,
    email: google.email,
    name: google.name,
    image: google.picture,
  };
}

async function googleChatProfile(google: GoogleProfile, tokens: TokenSet) {
  if (google.email_verified !== true) throw new Error("Google account email is not verified");
  const scopes = tokens.scope?.split(" ") ?? [];
  const granted = CHAT_SCOPES.every((scope) => scopes.includes(scope));
  return {
    id: google.sub,
    googleSub: google.sub,
    email: google.email,
    name: google.name,
    image: google.picture,
    ...(granted && tokens.refresh_token
      ? { encryptedGmailToken: await encrypt(tokens.refresh_token), scopes }
      : {}),
  };
}

// Chat/Drive access stays separate from the browser-only Gmail permission.
function googleChatProvider() {
  return Google({
    id: "google-chat",
    // Auth.js would otherwise look for AUTH_GOOGLE_CHAT_ID.
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
    authorization: {
      params: {
        scope: `openid email profile ${CHAT_SCOPES.join(" ")} ${DRIVE_SCOPE}`,
        access_type: "offline",
        prompt: "consent",
      },
    },
    profile: googleChatProfile,
  });
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google({
      // App account sign-in only. Gmail connects separately in the browser.
      authorization: { params: { scope: "openid email profile" } },
      profile: googleProfile,
    }),
    // Only registered when enabled, so nobody can ask Google for scopes the
    // consent screen doesn't list yet.
    ...(chatEnabled() ? [googleChatProvider()] : []),
  ],
  callbacks: {
    createOrUpdateUser: (ctx, args) =>
      upsertGoogleUser(ctx as unknown as MutationCtx, {
        existingUserId: args.existingUserId as Id<"users"> | null,
        profile: args.profile as GoogleSignInProfile,
      }),
  },
});

// Replaces Convex Auth's default user upsert so the Gmail token goes to
// gmailAccounts and never onto the user document.
export async function upsertGoogleUser(
  ctx: MutationCtx,
  { existingUserId, profile }: { existingUserId: Id<"users"> | null; profile: GoogleSignInProfile },
): Promise<Id<"users">> {
  const { encryptedGmailToken, googleSub, scopes, ...user } = profile;
  const fields = { ...user, emailVerificationTime: Date.now() };

  // existingUserId comes from the Google account id (sub). Never link by email:
  // a different Google account can end up with the same address (recreated
  // Workspace user, re-registered domain) and must not inherit this user's Gmail.
  // Each provider has its own authAccounts row, so the first sign-in through the
  // other one finds no existingUserId: link it by the same sub instead.
  existingUserId ??= googleSub ? await userForGoogleSub(ctx, googleSub) : null;
  let id: Id<"users">;
  if (existingUserId) {
    await ctx.db.patch(existingUserId, fields);
    id = existingUserId;
  } else {
    id = await ctx.db.insert("users", fields);
  }

  // No new token (Gmail box unticked): keep whatever connection already exists.
  if (encryptedGmailToken) {
    const existing = await ctx.db
      .query("gmailAccounts")
      .withIndex("by_user", (q) => q.eq("userId", id))
      .unique();
    const account = {
      userId: id,
      email: profile.email,
      encryptedRefreshToken: encryptedGmailToken,
      status: "active" as const,
      connectedAt: Date.now(),
      ...(scopes ? { scopes } : {}),
    };
    if (existing) await ctx.db.replace(existing._id, account);
    else await ctx.db.insert("gmailAccounts", account);
  }
  return id;
}

async function userForGoogleSub(ctx: MutationCtx, sub: string): Promise<Id<"users"> | null> {
  for (const provider of GOOGLE_PROVIDERS) {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", provider).eq("providerAccountId", sub))
      .unique();
    if (account) return account.userId;
  }
  return null;
}
