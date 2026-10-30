import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { type DownloadItem, type DownloadProgress, downloadAttachments } from "../lib/download";
import { connectGmailInBrowser, getBrowserGmailToken, revokeBrowserGmailToken } from "../lib/googleAuth";
import { getLocalGmailLabels, scanGmailLocally, type GmailLabel, type ScanProgress } from "../lib/localGmail";
import { formatBytes } from "../lib/format";
import { FilterBar, type ScanRequest } from "./FilterBar";
import { LocalAttachmentTable } from "./LocalAttachmentTable";

export function LocalGmail() {
  const removeOldServerGrant = useAction(api.gmail.migrateToLocal);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [cleaning, setCleaning] = useState(true);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [selected, setSelected] = useState(new Map<string, DownloadItem>());
  const [includeInline, setIncludeInline] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [scanning, setScanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const stopScan = useRef(false);

  // Revoke tokens from the old server-based version on this user's first visit
  // after deployment, then remove server-side Gmail metadata and scan results.
  useEffect(() => {
    let active = true;
    removeOldServerGrant()
      .catch((reason: unknown) => {
        if (active) setCleanupError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setCleaning(false);
      });
    return () => {
      active = false;
    };
  }, [removeOldServerGrant]);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await connectGmailInBrowser();
      setConnected(true);
      setLabels(await getLocalGmailLabels());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setConnecting(false);
    }
  };

  const runScan = async ({ query: search, extensions }: ScanRequest) => {
    setScanning(true);
    setError(null);
    setItems([]);
    setSelected(new Map());
    setProgress({ messages: 0, attachments: 0, done: false, limitReached: false });
    setQuery(search);
    stopScan.current = false;
    try {
      const found = await scanGmailLocally(search, extensions, setProgress, () => stopScan.current);
      setItems(found);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setScanning(false);
    }
  };

  const visible = items.filter((item) => includeInline || !item.isInline);
  const toggle = (item: DownloadItem) =>
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(item._id)) next.delete(item._id);
      else next.set(item._id, item);
      return next;
    });
  const togglePage = (page: DownloadItem[], select: boolean) =>
    setSelected((previous) => {
      const next = new Map(previous);
      for (const item of page) select ? next.set(item._id, item) : next.delete(item._id);
      return next;
    });

  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadAttachments([...selected.values()], getBrowserGmailToken, setDownloadProgress);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDownloading(false);
    }
  };

  const disconnect = async () => {
    await revokeBrowserGmailToken();
    setConnected(false);
    setLabels([]);
    setItems([]);
    setSelected(new Map());
    setProgress(null);
  };

  if (cleaning) return <div className="muted pad">Removing the previous server Gmail connection…</div>;
  if (cleanupError) {
    return (
      <div className="card connect">
        <h2>Finish securing your previous connection</h2>
        <p className="muted">The app couldn't remove the old server-held Gmail connection, so local Gmail search is paused.</p>
        <div className="banner bad">{cleanupError}</div>
        <button className="btn primary" onClick={() => location.reload()}>Try again</button>
      </div>
    );
  }
  if (!connected) {
    return (
      <div className="card connect">
        <h2>Connect Gmail on this device</h2>
        <p className="muted">
          Google grants read-only Gmail access to this browser. Searches, file details and downloads stay on this device;
          the Gmail token is held in memory and is never sent to our backend.
        </p>
        <button className="btn primary" disabled={connecting} onClick={() => void connect()}>
          {connecting ? "Opening Google…" : "Connect Gmail"}
        </button>
        {error && <div className="banner bad">{error}</div>}
      </div>
    );
  }

  const selectedBytes = [...selected.values()].reduce((sum, item) => sum + item.size, 0);
  return (
    <div className="extractor">
      <div className="topbar-actions local-connection">
        <span className="muted small">Gmail is connected in this browser</span>
        <button className="btn ghost small" onClick={() => void disconnect()}>Disconnect Gmail</button>
      </div>
      <FilterBar mode="gmail" scanning={scanning} labels={labels} onScan={(request) => void runScan(request)} />
      {scanning && (
        <div className="card scan-progress">
          <span className="strong">Searching Gmail on this device…</span>
          <p className="muted small">{progress?.messages.toLocaleString() ?? 0} emails checked · {progress?.attachments.toLocaleString() ?? 0} attachments found</p>
          <button className="btn ghost small" onClick={() => { stopScan.current = true; }}>Stop</button>
        </div>
      )}
      {progress?.done && (
        <section className="card results">
          <div className="results-head">
            <div className="strong">Found {visible.length.toLocaleString()} attachments</div>
            <div className="results-actions">
              <label className="toggle small">
                <input
                  type="checkbox"
                  checked={includeInline}
                  onChange={(event) => {
                    const include = event.target.checked;
                    setIncludeInline(include);
                    if (!include) setSelected((previous) => new Map([...previous].filter(([, item]) => !item.isInline)));
                  }}
                />
                Include inline images ({items.filter((item) => item.isInline).length.toLocaleString()})
              </label>
            </div>
          </div>
          <div className="muted small local-query">{progress.messages.toLocaleString()} emails checked · <code>{query}</code></div>
          {progress.limitReached && <div className="banner bad">Stopped at the safety limit of 25,000 emails or 10,000 attachments. Narrow the search to see the rest.</div>}
          <LocalAttachmentTable items={items} includeInline={includeInline} selected={selected} onToggle={toggle} onTogglePage={togglePage} />
        </section>
      )}
      {error && <div className="banner bad">{error}</div>}
      {progress?.done && visible.length > 0 && (
        <div className="download-bar">
          <div className="download-info">
            <span className="strong">{selected.size.toLocaleString()} selected</span>
            <span className="muted small">{formatBytes(selectedBytes)}</span>
            {selected.size < visible.length ? (
              <button className="link" onClick={() => setSelected(new Map(visible.map((item) => [item._id, item])))}>Select all {visible.length.toLocaleString()}</button>
            ) : (
              <button className="link" onClick={() => setSelected(new Map())}>Clear selection</button>
            )}
          </div>
          {downloadProgress && downloading && (
            <div className="progress"><div className="bar"><div style={{ width: `${(downloadProgress.done / downloadProgress.total) * 100}%` }} /></div>
              <span className="muted small">{downloadProgress.done}/{downloadProgress.total} · {formatBytes(downloadProgress.bytes)}</span>
            </div>
          )}
          <button className="btn primary" disabled={!selected.size || downloading} onClick={() => void download()}>
            {downloading ? "Downloading…" : selected.size === 1 ? "Download file" : "Download ZIP"}
          </button>
        </div>
      )}
    </div>
  );
}
