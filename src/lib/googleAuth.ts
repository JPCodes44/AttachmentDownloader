const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

type TokenResponse = { access_token: string; expires_in: number; error?: string };
type TokenClient = {
  callback: (response: TokenResponse) => void;
  requestAccessToken: (options?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(options: {
            client_id: string;
            scope: string;
            include_granted_scopes: boolean;
            callback: (response: TokenResponse) => void;
          }): TokenClient;
        };
      };
    };
  }
}

const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
let client: TokenClient | null = null;
let accessToken = "";
let expiresAt = 0;
let pending: Promise<string> | null = null;

function tokenClient(): TokenClient {
  if (!clientId) throw new Error("Gmail browser sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID.");
  if (!window.google) throw new Error("Google sign-in did not load. Check your connection and try again.");
  client ??= window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GMAIL_SCOPE,
    include_granted_scopes: false,
    callback: () => {},
  });
  return client;
}

function requestToken(prompt: string): Promise<string> {
  if (pending) return pending;
  pending = new Promise<string>((resolve, reject) => {
    try {
      const token = tokenClient();
      token.callback = (response) => {
        pending = null;
        if (response.error || !response.access_token) {
          reject(new Error(response.error === "access_denied" ? "Gmail access was not granted." : "Google could not connect Gmail."));
          return;
        }
        accessToken = response.access_token;
        expiresAt = Date.now() + Math.max(0, response.expires_in - 60) * 1000;
        resolve(accessToken);
      };
      token.requestAccessToken({ prompt });
    } catch (error) {
      pending = null;
      reject(error);
    }
  });
  return pending;
}

export function connectGmailInBrowser(): Promise<string> {
  return requestToken("consent");
}

export function getBrowserGmailToken(): Promise<string> {
  return accessToken && Date.now() < expiresAt ? Promise.resolve(accessToken) : requestToken("");
}

export function forgetBrowserGmailToken() {
  accessToken = "";
  expiresAt = 0;
}

export async function revokeBrowserGmailToken() {
  if (accessToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, { method: "POST" }).catch(() => {});
  }
  forgetBrowserGmailToken();
}
