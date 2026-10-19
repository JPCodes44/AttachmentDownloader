import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpRouter } from "convex/server";
import { components, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { encrypt } from "./crypto";
import { exchangeCode, getProfile } from "./gmailApi";

const http = httpRouter();

auth.addHttpRoutes(http);

function backToApp(result: string) {
  const url = new URL(process.env.SITE_URL ?? "http://localhost:3000");
  url.searchParams.set("gmail", result);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

// Google redirects here after the Gmail consent screen.
http.route({
  path: "/gmail/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const state = params.get("state");
    const code = params.get("code");
    if (params.get("error") || !state || !code) return backToApp("denied");

    const userId = await ctx.runMutation(internal.gmail.consumeState, { state });
    if (!userId) return backToApp("expired-link");

    try {
      const { accessToken, refreshToken } = await exchangeCode(code);
      const { emailAddress } = await getProfile(accessToken);
      await ctx.runMutation(internal.gmail.saveAccount, {
        userId,
        email: emailAddress,
        encryptedRefreshToken: await encrypt(refreshToken),
      });
      return backToApp("connected");
    } catch (err) {
      console.error("Gmail connect failed", err);
      return backToApp("error");
    }
  }),
});

// The built frontend (staging/production). Exact routes above take priority.
registerStaticRoutes(http, components.staticHosting);

export default http;
