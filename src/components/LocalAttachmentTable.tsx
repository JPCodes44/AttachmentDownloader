import type { DownloadItem } from "../lib/download";
import { formatDate, formatSize, senderName } from "../lib/format";

export function LocalAttachmentTable({
  items,
  includeInline,
  selected,
  onToggle,
  onTogglePage,
}: {
  items: DownloadItem[];
  includeInline: boolean;
  selected: Map<string, DownloadItem>;
  onToggle: (item: DownloadItem) => void;
  onTogglePage: (items: DownloadItem[], select: boolean) => void;
}) {
  const visible = items.filter((item) => includeInline || !item.isInline);
  const pageSelected = visible.length > 0 && visible.every((item) => selected.has(item._id));
  if (visible.length === 0) return <div className="empty">No attachments match this search.</div>;

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
                onChange={() => onTogglePage(visible, !pageSelected)}
              />
            </th>
            <th>File</th>
            <th>From</th>
            <th className="hide-sm">Subject</th>
            <th className="num">Size</th>
            <th className="num">Date</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item) => (
            <tr key={item._id} className={selected.has(item._id) ? "sel" : ""} onClick={() => onToggle(item)}>
              <td className="check">
                <input
                  type="checkbox"
                  aria-label={`Select ${item.filename}`}
                  checked={selected.has(item._id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => onToggle(item)}
                />
              </td>
              <td className="filename">
                <span className="ext">{item.filename.split(".").pop()?.slice(0, 4)}</span>
                <span className="name">{item.filename}</span>
                {(item as DownloadItem & { isInline?: boolean }).isInline && <span className="tag">inline</span>}
              </td>
              <td className="ellipsis" title={item.from}>
                {senderName(item.from ?? "")}
              </td>
              <td className="ellipsis hide-sm" title={item.subject}>
                {item.subject || <span className="muted">(no subject)</span>}
              </td>
              <td className="num">{formatSize(item.size)}</td>
              <td className="num">{formatDate(item.date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
