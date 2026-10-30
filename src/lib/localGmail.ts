import { extractAttachments, type GmailMessage } from "../../convex/parts";
import type { DownloadItem } from "./download";
import { getBrowserGmailToken } from "./googleAuth";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_MESSAGES = 25_000;
const MAX_ATTACHMENTS = 10_000;
const PARALLEL = 8;

export type GmailLabel = { id: string; name: string; system: boolean };
export type ScanProgress = { messages: number; attachments: number; done: boolean; limitReached: boolean };

async function gmailGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${await getBrowserGmailToken()}` } });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Gmail access expired. Connect Gmail again to continue.");
    if (response.status === 403) throw new Error("Google denied Gmail access. Check the permission and try again.");
    throw new Error(`Gmail returned ${response.status}. Try a narrower search.`);
  }
  return (await response.json()) as T;
}

export async function getLocalGmailLabels(): Promise<GmailLabel[]> {
  const { labels = [] } = await gmailGet<{ labels?: { id: string; name: string; type: string }[] }>("/labels");
  const searchable = new Set(["INBOX", "SENT", "STARRED", "IMPORTANT"]);
  return labels
    .filter((label) => label.type !== "system" || searchable.has(label.id))
    .map((label) => ({ id: label.id, name: label.name, system: label.type === "system" }))
    .sort((a, b) => Number(a.system) - Number(b.system) || a.name.localeCompare(b.name));
}

export async function scanGmailLocally(
  query: string,
  extensions: string[],
  onProgress: (progress: ScanProgress) => void,
  shouldStop: () => boolean,
): Promise<DownloadItem[]> {
  const results: DownloadItem[] = [];
  let messages = 0;
  let pageToken: string | undefined;
  let limitReached = false;
  const extensionSet = new Set(extensions.map((ext) => ext.toLowerCase()));

  do {
    if (shouldStop()) break;
    const page = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>("/messages", {
      q: query.trim() || "has:attachment",
      maxResults: "100",
      ...(pageToken ? { pageToken } : {}),
    });
    const batch = page.messages ?? [];
    const read = async (message: { id: string }) =>
      gmailGet<GmailMessage>(`/messages/${encodeURIComponent(message.id)}`, {
        format: "full",
        fields: "id,internalDate,payload",
      });
    for (let i = 0; i < batch.length; i += PARALLEL) {
      if (shouldStop()) break;
      const messagesPage = await Promise.all(batch.slice(i, i + PARALLEL).map(read));
      messages += messagesPage.length;
      for (const message of messagesPage) {
        for (const item of extractAttachments(message)) {
          const ext = item.filename.split(".").pop()?.toLowerCase() ?? "";
          if (extensionSet.size && !extensionSet.has(ext)) continue;
          results.push({ ...item, _id: `${item.messageId}:${item.attachmentId}`, source: "gmail" });
          if (results.length >= MAX_ATTACHMENTS) break;
        }
        if (results.length >= MAX_ATTACHMENTS) break;
      }
      onProgress({ messages, attachments: results.length, done: false, limitReached: false });
      if (messages >= MAX_MESSAGES || results.length >= MAX_ATTACHMENTS) {
        limitReached = !!page.nextPageToken || i + PARALLEL < batch.length;
        break;
      }
    }
    pageToken = limitReached ? undefined : page.nextPageToken;
    if (messages >= MAX_MESSAGES || results.length >= MAX_ATTACHMENTS) break;
  } while (pageToken);

  results.sort((a, b) => b.date - a.date);
  onProgress({ messages, attachments: results.length, done: true, limitReached });
  return results;
}
