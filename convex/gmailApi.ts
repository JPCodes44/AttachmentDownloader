// Thin wrappers over Google's OAuth and Gmail REST endpoints. No Convex imports, so tests can stub fetch.
import type { GmailMessage } from "./parts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

// Google says the refresh token is dead (revoked, or the 7-day Testing-mode limit passed).
export class GmailExpiredError extends Error {
  constructor() {
    super("Gmail connection expired. Reconnect Gmail to continue.");
  }
}

function clientCredentials() {
  const id = process.env.AUTH_GOOGLE_ID;
  const secret = process.env.AUTH_GOOGLE_SECRET;
  if (!id || !secret) throw new Error("AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET must be set");
  return { id, secret };
}

export function gmailRedirectUri(): string {
  return `${process.env.CONVEX_SITE_URL}/gmail/callback`;
}

export function buildConsentUrl(state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientCredentials().id,
    redirect_uri: gmailRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return url.toString();
}

async function tokenRequest(params: Record<string, string>) {
  const { id, secret } = clientCredentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  });
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok) {
    if (body.error === "invalid_grant") throw new GmailExpiredError();
    throw new Error(`Google token request failed: ${body.error_description ?? body.error ?? res.status}`);
  }
  return body;
}

export async function exchangeCode(code: string) {
  const body = await tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: gmailRedirectUri(),
  });
  if (!body.access_token || !body.refresh_token) {
    throw new Error("Google did not return a refresh token. Remove the app's access in your Google account and connect again.");
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

export async function refreshAccessToken(refreshToken: string) {
  const body = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  if (!body.access_token) throw new Error("Google did not return an access token");
  return { accessToken: body.access_token, expiresIn: body.expires_in ?? 3600 };
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GET a Gmail endpoint, retrying rate limits and server errors with backoff.
export async function gmailGet<T>(accessToken: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(GMAIL + path);
  for (const [k, val] of Object.entries(params)) url.searchParams.set(k, val);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 4) {
      throw new Error(`Gmail API ${path} failed with ${res.status}: ${await res.text()}`);
    }
    await sleep(500 * 2 ** attempt + Math.random() * 250);
  }
}

export type MessageList = { messages?: { id: string }[]; nextPageToken?: string };

export function listMessages(accessToken: string, q: string, pageToken?: string) {
  return gmailGet<MessageList>(accessToken, "/messages", {
    q,
    maxResults: "100",
    ...(pageToken ? { pageToken } : {}),
  });
}

export function getMessage(accessToken: string, id: string) {
  return gmailGet<GmailMessage>(accessToken, `/messages/${id}`, {
    format: "full",
    fields: "id,internalDate,payload",
  });
}

export function getProfile(accessToken: string) {
  return gmailGet<{ emailAddress: string }>(accessToken, "/profile");
}

export function listLabels(accessToken: string) {
  return gmailGet<{ labels?: { id: string; name: string; type: string }[] }>(accessToken, "/labels");
}

// Run fn over items with at most `limit` in flight, keeping input order.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
