import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { encrypt } from "./crypto";
import { GMAIL_SCOPE } from "./gmailApi";

// What profile() hands to createOrUpdateUser. The refresh token is already
// encrypted here, so it is never in plaintext in a mutation argument.
export type GoogleSignInProfile = {
  email: string;
  name?: string;
  image?: string;
  encryptedGmailToken?: string;
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google({
      // One consent screen: sign in AND read-only Gmail access, with a refresh
      // token (offline + consent) so scans keep working after the hour is up.
      authorization: {
        params: {
          scope: `openid email profile ${GMAIL_SCOPE}`,
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
        },
      },
      async profile(google, tokens) {
        // Google lets people untick the Gmail box, so check what was granted.
        const grantedGmail = tokens.scope?.split(" ").includes(GMAIL_SCOPE) ?? false;
        if (google.email_verified !== true) throw new Error("Google account email is not verified");
        return {
          id: google.sub,
          email: google.email,
          name: google.name,
          image: google.picture,
          ...(grantedGmail && tokens.refresh_token
            ? { encryptedGmailToken: await encrypt(tokens.refresh_token) }
            : {}),
        };
      },
    }),
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
  const { encryptedGmailToken, ...user } = profile;
  const fields = { ...user, emailVerificationTime: Date.now() };

  // existingUserId comes from the Google account id (sub). Never link by email:
  // a different Google account can end up with the same address (recreated
  // Workspace user, re-registered domain) and must not inherit this user's Gmail.
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
    };
    if (existing) await ctx.db.replace(existing._id, account);
    else await ctx.db.insert("gmailAccounts", account);
  }
  return id;
}
