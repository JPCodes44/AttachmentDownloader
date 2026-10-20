import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import {
  buildChatFilter,
  buildQuery,
  type ChatType,
  EMPTY_FILTERS,
  extensionsFor,
  FILE_TYPES,
  type FileTypeKey,
  type Filters,
} from "../lib/gmailQuery";
import { ChatPicker } from "./ChatPicker";

type Label = { id: string; name: string; system: boolean };

export type ScanMode = "gmail" | "chat" | "both";

export type ScanRequest = {
  query: string;
  chatFilter: string;
  extensions: string[];
  chatSpaceTypes: ChatType[];
  chatSpaceNames: string[];
};

export function FilterBar({
  mode,
  scanning,
  onScan,
}: {
  mode: ScanMode;
  scanning: boolean;
  onScan: (scan: ScanRequest) => void;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [chatTypes, setChatTypes] = useState<ChatType[]>([]);
  const [chatNames, setChatNames] = useState<string[]>([]);
  const [customQuery, setCustomQuery] = useState<string | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const listLabels = useAction(api.gmail.listLabels);

  useEffect(() => {
    listLabels().then(setLabels, () => setLabels([]));
  }, [listLabels]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setCustomQuery(null);
  };
  const toggleType = (t: FileTypeKey) =>
    set("fileTypes", filters.fileTypes.includes(t) ? filters.fileTypes.filter((x) => x !== t) : [...filters.fileTypes, t]);

  // Chat can only filter by date and file type, so the email-only fields are hidden for Chat alone.
  const chat = mode === "chat";
  const query = customQuery ?? buildQuery(filters);

  return (
    <form
      className="card filters"
      onSubmit={(e) => {
        e.preventDefault();
        onScan({
          query,
          chatFilter: buildChatFilter(filters),
          extensions: extensionsFor(filters.fileTypes),
          chatSpaceTypes: chatTypes,
          chatSpaceNames: chatNames,
        });
      }}
    >
      <div className="filter-grid">
        {!chat && (
          <>
            <label className="field wide">
              <span>Search words</span>
              <input
                id="f-text"
                value={filters.text}
                placeholder="invoice, contract, holiday…"
                onChange={(e) => set("text", e.target.value)}
              />
            </label>
            <label className="field">
              <span>From</span>
              <input
                id="f-from"
                value={filters.from}
                placeholder="name or email"
                onChange={(e) => set("from", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Label</span>
              <select id="f-label" value={filters.label} onChange={(e) => set("label", e.target.value)}>
                <option value="">Any label</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.system ? l.id.toLowerCase() : l.name}>
                    {l.system ? l.name.charAt(0) + l.name.slice(1).toLowerCase() : l.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="field">
          <span>After</span>
          <input id="f-after" type="date" value={filters.after} onChange={(e) => set("after", e.target.value)} />
        </label>
        <label className="field">
          <span>Before</span>
          <input id="f-before" type="date" value={filters.before} onChange={(e) => set("before", e.target.value)} />
        </label>
        {!chat && (
          <label className="field">
            <span>Bigger than (MB)</span>
            <input
              id="f-larger"
              type="number"
              min="0"
              step="0.5"
              value={filters.largerThanMb}
              onChange={(e) => set("largerThanMb", e.target.value)}
            />
          </label>
        )}
      </div>

      {mode === "both" && (
        <p className="muted small filter-note">Search words, From, Label and size only apply to email.</p>
      )}

      {mode !== "gmail" && (
        <ChatPicker types={chatTypes} names={chatNames} onTypes={setChatTypes} onNames={setChatNames} />
      )}

      <fieldset className="chips">
        <legend>File types</legend>
        {(Object.keys(FILE_TYPES) as FileTypeKey[]).map((t) => (
          <button
            type="button"
            key={t}
            className={`chip ${filters.fileTypes.includes(t) ? "on" : ""}`}
            aria-pressed={filters.fileTypes.includes(t)}
            onClick={() => toggleType(t)}
          >
            {FILE_TYPES[t].label}
          </button>
        ))}
      </fieldset>

      <div className="query-row">
        {chat ? (
          <p className="muted small chat-note">
            Google Chat has no search, so every message in the date range is checked. A wide range can take a while.
          </p>
        ) : (
          <label className="field grow">
            <span>Gmail search (edit it if you know Gmail's search syntax)</span>
            <input id="f-query" className="mono" value={query} onChange={(e) => setCustomQuery(e.target.value)} />
          </label>
        )}
        <button className="btn primary" type="submit" disabled={scanning}>
          {scanning ? "Scanning…" : "Find attachments"}
        </button>
      </div>
    </form>
  );
}
