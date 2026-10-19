import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";

export function ConnectGmail({ expiredEmail }: { expiredEmail?: string }) {
  const createConnectUrl = useMutation(api.gmail.createConnectUrl);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    location.href = await createConnectUrl();
  };

  return (
    <div className="card connect">
      {expiredEmail ? (
        <>
          <h2>Gmail connection expired</h2>
          <p className="muted">
            Google ended this app's access to <b>{expiredEmail}</b>. While the app is in Google's testing mode this
            happens every 7 days. Reconnect to keep going.
          </p>
        </>
      ) : (
        <>
          <h2>Connect your Gmail</h2>
          <p className="muted">
            The app asks for <b>read-only</b> access. It can list your emails and download attachments, but it can't
            send, change or delete anything.
          </p>
        </>
      )}
      <button className="btn primary" disabled={busy} onClick={() => void connect()}>
        {busy ? "Opening Google…" : expiredEmail ? "Reconnect Gmail" : "Connect Gmail"}
      </button>
    </div>
  );
}
