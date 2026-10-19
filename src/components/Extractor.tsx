import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { type DownloadItem, type DownloadProgress, downloadAttachments } from "../lib/download";
import { formatBytes } from "../lib/format";
import { AttachmentTable } from "./AttachmentTable";
import { FilterBar } from "./FilterBar";

export function Extractor() {
  const convex = useConvex();
  const scan = useQuery(api.scans.latest);
  const startScan = useMutation(api.scans.start);
  const cancelScan = useMutation(api.scans.cancel);
  const getAccessToken = useAction(api.gmail.getAccessToken);

  const [includeInline, setIncludeInline] = useState(false);
  const [selected, setSelected] = useState(new Map<string, DownloadItem>());
  const [selectingAll, setSelectingAll] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scanId = scan?._id;
  useEffect(() => setSelected(new Map()), [scanId, includeInline]);

  const running = scan?.status === "running";
  const total = scan ? scan.attachmentsFound + (includeInline ? scan.inlineFound : 0) : 0;
  const selectedBytes = [...selected.values()].reduce((sum, i) => sum + i.size, 0);

  const toggle = (item: DownloadItem) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item._id)) next.delete(item._id);
      else next.set(item._id, item);
      return next;
    });

  const togglePage = (items: DownloadItem[], select: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const i of items) {
        if (select) next.set(i._id, i);
        else next.delete(i._id);
      }
      return next;
    });

  const selectAll = async () => {
    if (!scanId) return;
    setSelectingAll(true);
    try {
      const all = await convex.query(api.attachments.allForScan, { scanId, includeInline });
      setSelected(new Map(all.map((i) => [i._id, i])));
    } finally {
      setSelectingAll(false);
    }
  };

  const download = async () => {
    setError(null);
    setDownloading(true);
    try {
      await downloadAttachments(
        [...selected.values()],
        async () => (await getAccessToken()).accessToken,
        setProgress,
      );
    } catch (err) {
      setError(
        err instanceof ConvexError
          ? String(err.data)
          : `Download failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setDownloading(false);
    }
  };

  const scanError = scan?.status === "error" && scan.error !== "GMAIL_EXPIRED" ? scan.error : null;

  return (
    <div className="extractor">
      <FilterBar
        scanning={running}
        onScan={(query, extensions) => {
          setError(null);
          startScan({ query, extensions }).catch((e: unknown) =>
            setError(e instanceof ConvexError ? String(e.data) : String(e)),
          );
        }}
      />

      {scan && (
        <section className="card results">
          <div className="results-head">
            <div className="scan-status">
              <span className={`dot ${scan.status}`} aria-hidden="true" />
              <div>
                <div className="strong">
                  {running
                    ? "Scanning your mailbox…"
                    : scan.status === "done"
                      ? `Found ${total.toLocaleString()} attachment${total === 1 ? "" : "s"}`
                      : scan.status === "cancelled"
                        ? "Scan stopped"
                        : "Scan failed"}
                </div>
                <div className="muted small">
                  {scan.messagesScanned.toLocaleString()} emails checked · {total.toLocaleString()} attachments ·{" "}
                  <code>{scan.query}</code>
                </div>
              </div>
            </div>
            <div className="results-actions">
              {running && (
                <button className="btn ghost small" onClick={() => void cancelScan({ scanId: scan._id })}>
                  Stop
                </button>
              )}
              <label className="toggle small">
                <input
                  id="include-inline"
                  type="checkbox"
                  checked={includeInline}
                  onChange={(e) => setIncludeInline(e.target.checked)}
                />
                Include inline images ({scan.inlineFound.toLocaleString()})
              </label>
            </div>
          </div>
          {running && <div className="indeterminate" aria-hidden="true" />}
          {scanError && <div className="banner bad">{scanError}</div>}

          <AttachmentTable
            scanId={scan._id}
            includeInline={includeInline}
            selected={selected}
            onToggle={toggle}
            onTogglePage={togglePage}
          />
        </section>
      )}

      {error && <div className="banner bad">{error}</div>}

      {scan && total > 0 && (
        <div className="download-bar">
          <div className="download-info">
            <span className="strong">{selected.size.toLocaleString()} selected</span>
            <span className="muted small">{formatBytes(selectedBytes)}</span>
            {selected.size < total ? (
              <button className="link" disabled={selectingAll} onClick={() => void selectAll()}>
                {selectingAll ? "Selecting…" : `Select all ${total.toLocaleString()}`}
              </button>
            ) : (
              <button className="link" onClick={() => setSelected(new Map())}>
                Clear selection
              </button>
            )}
          </div>
          {progress && (downloading || progress.failed.length > 0) && (
            <div className="progress">
              <div className="bar">
                <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <span className="muted small">
                {progress.done}/{progress.total} · {formatBytes(progress.bytes)}
                {progress.failed.length > 0 && ` · ${progress.failed.length} failed`}
              </span>
            </div>
          )}
          <button className="btn primary" disabled={selected.size === 0 || downloading} onClick={() => void download()}>
            {downloading ? "Downloading…" : selected.size === 1 ? "Download file" : "Download ZIP"}
          </button>
        </div>
      )}
    </div>
  );
}
