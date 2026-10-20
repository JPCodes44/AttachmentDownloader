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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => sleep(500 * 2 ** attempt + Math.random() * 250);
const MAX_ATTEMPTS = 5;

// fetch, retrying network failures (DNS, reset connections) with backoff.
async function fetchRetrying(url: string | URL, init: RequestInit, attempt: number): Promise<Response | null> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS - 1) throw err;
    return null;
  }
}

async function tokenRequest(params: Record<string, string>) {
  const { id, secret } = clientCredentials();
  for (let attempt = 0; ; attempt++) {
    const res = await fetchRetrying(
      TOKEN_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
      },
      attempt,
    );
    if (!res || (res.status >= 500 && attempt < MAX_ATTEMPTS - 1)) {
      await backoff(attempt);
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as {
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

// Gmail's per-user quota errors come back as 403 with one of these reasons.
const RATE_LIMIT_REASONS = /"(rateLimitExceeded|userRateLimitExceeded)"/;

export class GmailNotFoundError extends Error {}

// GET a Gmail endpoint, retrying network errors, rate limits and server errors with backoff.
export async function gmailGet<T>(accessToken: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(GMAIL + path);
  for (const [k, val] of Object.entries(params)) url.searchParams.set(k, val);
  for (let attempt = 0; ; attempt++) {
    const res = await fetchRetrying(url, { headers: { Authorization: `Bearer ${accessToken}` } }, attempt);
    if (!res) {
      await backoff(attempt);
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    const text = await res.text();
    if (res.status === 404) throw new GmailNotFoundError(`Gmail API ${path} not found`);
    const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && RATE_LIMIT_REASONS.test(text));
    if (!retryable || attempt >= MAX_ATTEMPTS - 1) {
      throw new Error(`Gmail API ${path} failed with ${res.status}: ${text}`);
    }
    await backoff(attempt);
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

// Null when the message was deleted between listing and fetching it.
export async function getMessage(accessToken: string, id: string): Promise<GmailMessage | null> {
  try {
    return await gmailGet<GmailMessage>(accessToken, `/messages/${id}`, {
      format: "full",
      fields: "id,internalDate,payload",
    });
  } catch (err) {
    if (err instanceof GmailNotFoundError) return null;
    throw err;
  }
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
