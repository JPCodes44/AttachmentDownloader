import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";

// Shown when signed in but without a working Gmail connection. Fixing it is
// just signing in with Google again, this time with the Gmail box ticked.
export function ConnectGmail({ expiredEmail }: { expiredEmail?: string }) {
  const { signIn } = useAuthActions();
  const [busy, setBusy] = useState(false);

  return (
    <div className="card connect">
      {expiredEmail ? (
        <>
          <h2>Gmail access expired</h2>
          <p className="muted">
            Google ended this app's access to <b>{expiredEmail}</b>. While the app is in Google's testing mode this
            happens every 7 days. Sign in with Google again to keep going.
          </p>
        </>
      ) : (
        <>
          <h2>Gmail isn't connected</h2>
          <p className="muted">
            The app needs <b>read-only</b> Gmail access to find your attachments. Sign in again and make sure the
            Gmail box is ticked on Google's permission screen.
          </p>
        </>
      )}
      <button
        className="btn primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signIn("google");
        }}
      >
        {busy ? "Opening Google…" : "Sign in with Google again"}
      </button>
    </div>
  );
}
