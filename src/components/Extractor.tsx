import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { type DownloadItem, type DownloadProgress, downloadAttachments, type Source } from "../lib/download";
import { formatBytes } from "../lib/format";
import { AttachmentTable } from "./AttachmentTable";
import { ConnectChat } from "./ConnectChat";
import { FilterBar, type ScanMode } from "./FilterBar";

const MODES: { mode: ScanMode; label: string }[] = [
  { mode: "gmail", label: "Gmail" },
  { mode: "chat", label: "Google Chat" },
  { mode: "both", label: "Both" },
];

// Hidden until Google approves the Chat scopes on the consent screen.
const CHAT_ENABLED = process.env.VITE_GOOGLE_CHAT === "on";

const ERROR_MESSAGES: Record<string, string> = {
  CHAT_UNAVAILABLE:
    "Google Chat isn't available for this account. It works with Google Workspace (work or school) accounts where Chat is turned on.",
  CHAT_NOT_CONNECTED: "Connect Google Chat first.",
};

const errorText = (code: string) => ERROR_MESSAGES[code] ?? code;

export function Extractor({ chatConnected, driveConnected }: { chatConnected: boolean; driveConnected: boolean }) {
  const convex = useConvex();
  const { signIn } = useAuthActions();
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
  const [mode, setMode] = useState<ScanMode>("gmail");
  // Scans of both: show only email or only Chat results.
  const [resultSource, setResultSource] = useState<Source | undefined>(undefined);

  const scanId = scan?._id;
  const scanMode: ScanMode = scan?.source ?? "gmail";
  const chatScan = scanMode === "chat";
  const bothScan = scanMode === "both";
  useEffect(() => setResultSource(undefined), [scanId]);
  useEffect(() => setSelected(new Map()), [scanId, includeInline, resultSource]);

  const running = scan?.status === "running";
  const chatFound = scan?.chatFound ?? 0;
  const emailFound = (scan?.attachmentsFound ?? 0) - chatFound;
  const inline = includeInline && resultSource !== "chat" ? (scan?.inlineFound ?? 0) : 0;
  const total =
    (resultSource === "chat" ? chatFound : resultSource === "gmail" ? emailFound : (scan?.attachmentsFound ?? 0)) +
    inline;
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
      const all = await convex.query(api.attachments.allForScan, { scanId, includeInline, source: resultSource });
      setSelected(new Map(all.map((i) => [i._id, i])));
    } catch (err) {
      setError(`Couldn't select everything: ${err instanceof Error ? err.message : String(err)}`);
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

  // A scan of both that couldn't read Chat still finishes, with the error saved alongside the email results.
  const scanError =
    scan?.error && scan.error !== "GMAIL_EXPIRED" && scan.status !== "running" ? errorText(scan.error) : null;
  const driveSkipped = scan?.driveFilesSkipped ?? 0;
  const spaceCount = scan?.spaceCount ?? 0;
  // spaceIndex is the chat being read; a scan that finished normally has been through all of them.
  const chatMessages = scan?.chatMessagesScanned ?? 0;
  const chatsChecked =
    scan?.status === "done" && !scan.limitReached ? spaceCount : Math.min((scan?.spaceIndex ?? 0) + 1, spaceCount);

  return (
    <div className="extractor">
      {CHAT_ENABLED && (
        <div className="source-toggle" role="group" aria-label="Search in">
          {MODES.map((m) => (
            <button
              type="button"
              key={m.mode}
              className={`chip ${mode === m.mode ? "on" : ""}`}
              aria-pressed={mode === m.mode}
              onClick={() => setMode(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {mode !== "gmail" && !chatConnected ? (
        <ConnectChat />
      ) : (
        <FilterBar
          mode={mode}
          scanning={running}
          onScan={(request) => {
            setError(null);
            startScan({ ...request, source: mode }).catch((e: unknown) =>
              setError(e instanceof ConvexError ? errorText(String(e.data)) : String(e)),
            );
          }}
        />
      )}

      {scan && (
        <section className="card results">
          <div className="results-head">
            <div className="scan-status">
              <span className={`dot ${scan.status}`} aria-hidden="true" />
              <div>
                <div className="strong">
                  {running
                    ? chatScan || scan.spaceCount !== undefined
                      ? "Scanning your chats…"
                      : "Scanning your mailbox…"
                    : scan.status === "done"
                      ? `Found ${total.toLocaleString()} attachment${total === 1 ? "" : "s"}`
                      : scan.status === "cancelled"
                        ? "Scan stopped"
                        : "Scan failed"}
                </div>
                <div className="muted small">
                  {chatScan ? (
                    <>
                      {scan.messagesScanned.toLocaleString()} messages checked in {chatsChecked.toLocaleString()} of{" "}
                      {spaceCount.toLocaleString()} chats · {total.toLocaleString()} files
                    </>
                  ) : bothScan ? (
                    <>
                      {(scan.messagesScanned - chatMessages).toLocaleString()} emails and {chatMessages.toLocaleString()}{" "}
                      chat messages checked
                      {scan.spaceCount !== undefined &&
                        ` in ${chatsChecked.toLocaleString()} of ${spaceCount.toLocaleString()} chats`}{" "}
                      · {total.toLocaleString()} files
                    </>
                  ) : (
                    <>
                      {scan.messagesScanned.toLocaleString()} emails checked · {total.toLocaleString()} attachments ·{" "}
                      <code>{scan.query}</code>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="results-actions">
              {running && (
                <button className="btn ghost small" onClick={() => void cancelScan({ scanId: scan._id })}>
                  Stop
                </button>
              )}
              {!chatScan && (
                <label className="toggle small">
                  <input
                    id="include-inline"
                    type="checkbox"
                    checked={includeInline}
                    onChange={(e) => setIncludeInline(e.target.checked)}
                  />
                  Include inline images ({scan.inlineFound.toLocaleString()})
                </label>
              )}
            </div>
          </div>
          {running && <div className="indeterminate" aria-hidden="true" />}
          {scanError && <div className="banner bad">{scanError}</div>}
          {scan.limitReached && (
            <div className="banner bad">
              {scanMode !== "gmail"
                ? "Stopped early: a search covers at most 2,000 chats, 25,000 messages or 10,000 files. " +
                  "Narrow the dates to see the rest."
                : "Stopped early: a search covers at most 25,000 emails or 10,000 attachments. " +
                  "Narrow your search to see the rest."}
            </div>
          )}
          {driveSkipped > 0 &&
            (scan.driveAccess ? (
              <div className="banner bad">
                {driveSkipped.toLocaleString()} Drive item{driveSkipped === 1 ? "" : "s"} (forms, folders or shortcuts)
                can't be downloaded as files.
              </div>
            ) : driveConnected ? (
              <div className="banner bad">
                {driveSkipped.toLocaleString()} file{driveSkipped === 1 ? " was" : "s were"} shared from Google Drive.
                Search again to include {driveSkipped === 1 ? "it" : "them"}.
              </div>
            ) : (
              <div className="banner bad">
                {driveSkipped.toLocaleString()} file{driveSkipped === 1 ? " was" : "s were"} shared from Google Drive and
                skipped.{" "}
                <button className="link" onClick={() => void signIn("google-chat")}>
                  Allow Drive access
                </button>{" "}
                to download {driveSkipped === 1 ? "it" : "them"} too.
              </div>
            ))}

          {bothScan && (
            <div className="result-filter" role="group" aria-label="Show results from">
              {(
                [
                  [undefined, "All", scan.attachmentsFound],
                  ["gmail", "Email", emailFound],
                  ["chat", "Chat", chatFound],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  type="button"
                  key={label}
                  className={`chip ${resultSource === value ? "on" : ""}`}
                  aria-pressed={resultSource === value}
                  onClick={() => setResultSource(value)}
                >
                  {label} ({count.toLocaleString()})
                </button>
              ))}
            </div>
          )}

          <AttachmentTable
            mode={scanMode}
            source={resultSource}
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
            {!chatScan && <span className="muted small">{formatBytes(selectedBytes)}</span>}
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
