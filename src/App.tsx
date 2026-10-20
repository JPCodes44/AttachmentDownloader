import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { ConnectGmail } from "./components/ConnectGmail";
import { Extractor } from "./components/Extractor";
import { SignIn } from "./components/SignIn";

export function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) return <div className="center muted">Loading…</div>;
  if (!isAuthenticated) return <SignIn />;
  return <SignedIn />;
}

function SignedIn() {
  const gmail = useQuery(api.gmail.status);
  const disconnect = useAction(api.gmail.disconnect);
  const deleteAccount = useAction(api.account.deleteAccount);
  const { signOut } = useAuthActions();

  const confirmDelete = async () => {
    if (!confirm("Delete your account? This revokes Gmail access and deletes your search results.")) return;
    await deleteAccount();
    await signOut().catch(() => {}); // the session is already gone server-side
  };

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
          <button className="btn ghost small" onClick={() => void confirmDelete()}>
            Delete account
          </button>
        </div>
      </header>

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
