import { usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { DownloadItem, Source } from "../lib/download";
import type { ScanMode } from "./FilterBar";
import { formatDate, formatSize, senderName } from "../lib/format";

export function AttachmentTable({
  mode,
  source,
  scanId,
  includeInline,
  selected,
  onToggle,
  onTogglePage,
}: {
  mode: ScanMode;
  // Only email or only Chat rows, for scans of both.
  source?: Source;
  scanId: Id<"scans">;
  includeInline: boolean;
  selected: Map<string, DownloadItem>;
  onToggle: (item: DownloadItem) => void;
  onTogglePage: (items: DownloadItem[], select: boolean) => void;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.attachments.list,
    { scanId, includeInline, source },
    { initialNumItems: 50 },
  );

  if (status === "LoadingFirstPage") return <div className="muted pad">Loading…</div>;
  if (results.length === 0) return <div className="empty">No attachments yet.</div>;

  const pageSelected = results.every((r) => selected.has(r._id));

  return (
    <div className="table-wrap">
      <table className="files">
        <thead>
          <tr>
            <th className="check">
              <input
                id="select-page"
                type="checkbox"
                aria-label="Select all shown"
                checked={pageSelected}
                onChange={() => onTogglePage(results, !pageSelected)}
              />
            </th>
            <th>File</th>
            <th>{mode === "chat" ? "Chat" : mode === "both" ? "From / chat" : "From"}</th>
            <th className="hide-sm">{mode === "chat" ? "Message" : mode === "both" ? "Subject / message" : "Subject"}</th>
            <th className="num">Size</th>
            <th className="num">Date</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r._id} className={selected.has(r._id) ? "sel" : ""} onClick={() => onToggle(r)}>
              <td className="check">
                <input
                  id={`sel-${r._id}`}
                  type="checkbox"
                  aria-label={`Select ${r.filename}`}
                  checked={selected.has(r._id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggle(r)}
                />
              </td>
              <td className="filename">
                <span className="ext">{r.filename.split(".").pop()?.slice(0, 4)}</span>
                <span className="name">{r.filename}</span>
                <span className={`tag source-tag ${r.source ?? "gmail"}`}>{r.source === "chat" ? "Chat" : "Email"}</span>
                {r.attachmentId.startsWith("drive") && r.source === "chat" && <span className="tag">Drive</span>}
                {r.isInline && <span className="tag">inline</span>}
              </td>
              <td className="ellipsis" title={r.from}>
                {senderName(r.from)}
              </td>
              <td className="ellipsis hide-sm" title={r.subject}>
                {r.subject || <span className="muted">{r.source === "chat" ? "(no text)" : "(no subject)"}</span>}
              </td>
              <td className="num">{formatSize(r.size)}</td>
              <td className="num">{formatDate(r.date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {status === "CanLoadMore" && (
        <button className="btn ghost load-more" onClick={() => loadMore(100)}>
          Show more
        </button>
      )}
      {status === "LoadingMore" && <div className="muted pad">Loading…</div>}
    </div>
  );
}
