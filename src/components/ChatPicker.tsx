import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { ChatSpaceOption } from "../../convex/chat";
import { CHAT_TYPES, type ChatType } from "../lib/gmailQuery";

// Chat type chips, plus an optional list of named chats. Picked chats are searched
// instead of the types; the types then only narrow the list to pick from.
export function ChatPicker({
  types,
  names,
  onTypes,
  onNames,
}: {
  types: ChatType[];
  names: string[];
  onTypes: (types: ChatType[]) => void;
  onNames: (names: string[]) => void;
}) {
  const listChatSpaces = useAction(api.chat.listChatSpaces);
  const [spaces, setSpaces] = useState<ChatSpaceOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listChatSpaces().then(setSpaces, (e: unknown) =>
      setLoadError(
        e instanceof ConvexError && e.data === "CHAT_UNAVAILABLE"
          ? "Google Chat isn't available for this account."
          : "Couldn't load your chats.",
      ),
    );
  }, [listChatSpaces]);

  const typeOk = (t: string) => types.length === 0 || types.some((x) => x === t);
  const pickable = (spaces ?? []).filter((s) => s.named && typeOk(s.type));
  const shown = pickable.filter((s) => s.label.toLowerCase().includes(search.trim().toLowerCase()));

  const toggleType = (t: ChatType) => onTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t]);
  const toggleName = (n: string) => onNames(names.includes(n) ? names.filter((x) => x !== n) : [...names, n]);

  return (
    <div className="chat-filters">
      <fieldset className="chips">
        <legend>Chat types</legend>
        {(Object.keys(CHAT_TYPES) as ChatType[]).map((t) => (
          <button
            type="button"
            key={t}
            className={`chip ${types.includes(t) ? "on" : ""}`}
            aria-pressed={types.includes(t)}
            onClick={() => toggleType(t)}
          >
            {CHAT_TYPES[t]}
          </button>
        ))}
      </fieldset>

      <details className="chat-picker">
        <summary>
          {names.length === 0
            ? "All chats of these types"
            : `Only ${names.length} picked chat${names.length === 1 ? "" : "s"}`}
          <span className="muted small"> · pick specific spaces or named group chats</span>
        </summary>
        {loadError ? (
          <p className="muted small">{loadError}</p>
        ) : spaces === null ? (
          <p className="muted small">Loading your chats…</p>
        ) : pickable.length === 0 ? (
          <p className="muted small">No named chats to pick. Use the chat types above instead.</p>
        ) : (
          <>
            <div className="chat-picker-head">
              <input
                id="chat-search"
                placeholder="Find a chat"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {names.length > 0 && (
                <button type="button" className="link small" onClick={() => onNames([])}>
                  Clear
                </button>
              )}
            </div>
            <ul className="chat-list">
              {shown.map((s) => (
                <li key={s.name}>
                  <label className="toggle small">
                    <input
                      id={`chat-${s.name}`}
                      type="checkbox"
                      checked={names.includes(s.name)}
                      onChange={() => toggleName(s.name)}
                    />
                    {s.label}
                    <span className="muted">{s.type === "SPACE" ? "space" : "group chat"}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="muted small">
              Direct messages have no names in Google Chat, so they can't be picked one by one. Use the "Direct
              messages" type to include them.
            </p>
          </>
        )}
      </details>
    </div>
  );
}
