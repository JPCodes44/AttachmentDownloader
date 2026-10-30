import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth } from "convex/react";
import { api } from "../convex/_generated/api";
import { LocalGmail } from "./components/LocalGmail";
import { SignIn } from "./components/SignIn";
import { revokeBrowserGmailToken } from "./lib/googleAuth";

export function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  // The landing page shows while auth loads too: it matches the prerendered
  // HTML, so signed-out visitors (most of them) see no flash of "Loading…".
  if (isLoading || !isAuthenticated) return <SignIn />;
  return <SignedIn />;
}

function SignedIn() {
  const deleteAccount = useAction(api.account.deleteAccount);
  const { signOut } = useAuthActions();

  const confirmDelete = async () => {
    if (!confirm("Delete your account? This revokes Google access and deletes your search results.")) return;
    await revokeBrowserGmailToken();
    await deleteAccount();
    await signOut().catch(() => {}); // the session is already gone server-side
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          AttachmentDownloader
        </div>
        <div className="topbar-actions">
          <button className="btn ghost small" onClick={() => void signOut()}>
            Sign out
          </button>
          <button className="btn ghost small" onClick={() => void confirmDelete()}>
            Delete account
          </button>
        </div>
      </header>

      <main className="main">
        <LocalGmail />
      </main>
    </div>
  );
}
