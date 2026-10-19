import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../convex/_generated/api";
import { ConnectGmail } from "./components/ConnectGmail";
import { Extractor } from "./components/Extractor";
import { SignIn } from "./components/SignIn";

const CONNECT_RESULTS: Record<string, { tone: "ok" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "Gmail connected." },
  denied: { tone: "bad", text: "Gmail access was not granted." },
  "expired-link": { tone: "bad", text: "That connect link expired. Try again." },
  error: { tone: "bad", text: "Something went wrong connecting Gmail. Try again." },
};

// Reads ?gmail=… left by the OAuth callback once, then tidies the URL.
function useConnectResult() {
  const [result] = useState(() => new URLSearchParams(location.search).get("gmail"));
  useEffect(() => {
    if (!result) return;
    const url = new URL(location.href);
    url.searchParams.delete("gmail");
    history.replaceState(null, "", url);
  }, [result]);
  return result ? CONNECT_RESULTS[result] : undefined;
}

export function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const connectResult = useConnectResult();

  if (isLoading) return <div className="center muted">Loading…</div>;
  if (!isAuthenticated) return <SignIn />;
  return <SignedIn notice={connectResult} />;
}

function SignedIn({ notice }: { notice?: { tone: "ok" | "bad"; text: string } }) {
  const gmail = useQuery(api.gmail.status);
  const disconnect = useAction(api.gmail.disconnect);
  const { signOut } = useAuthActions();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Gmail Attachments
        </div>
        <div className="topbar-actions">
          {gmail?.connected && (
            <>
              <span className="muted small">{gmail.email}</span>
              <button className="btn ghost small" onClick={() => void disconnect()}>
                Disconnect Gmail
              </button>
            </>
          )}
          <button className="btn ghost small" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {notice && <div className={`banner ${notice.tone}`}>{notice.text}</div>}

      <main className="main">
        {gmail === undefined ? (
          <div className="muted">Loading…</div>
        ) : !gmail?.connected ? (
          <ConnectGmail />
        ) : gmail.status === "expired" ? (
          <ConnectGmail expiredEmail={gmail.email} />
        ) : (
          <Extractor />
        )}
      </main>
    </div>
  );
}
