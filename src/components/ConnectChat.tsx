import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";

// Shown when Google Chat is picked but not connected yet. Connecting is signing
// in with Google again, this time also granting read-only Chat access.
export function ConnectChat() {
  const { signIn } = useAuthActions();
  const [busy, setBusy] = useState(false);

  return (
    <div className="card connect">
      <h2>Connect Google Chat</h2>
      <p className="muted">
        The app needs <b>read-only</b> access to your Google Chat messages to find files shared in DMs, group chats and
        spaces, and to Google Drive to download files shared from Drive. This works for Google Workspace (work or
        school) accounts only.
      </p>
      <button
        className="btn primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signIn("google-chat");
        }}
      >
        {busy ? "Opening Google…" : "Connect Google Chat"}
      </button>
    </div>
  );
}
