import { downloadZip } from "client-zip";
import { uniqueFilenames } from "./filenames";

export type DownloadItem = {
  _id: string;
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  date: number;
};

export type DownloadProgress = { done: number; total: number; bytes: number; failed: string[] };

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const PARALLEL = 4;

type SaveFilePicker = (opts: { suggestedName: string }) => Promise<{
  createWritable(): Promise<WritableStream>;
}>;

export function base64UrlToBytes(data: string): Uint8Array<ArrayBuffer> {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetches attachment bytes straight from Gmail with a short-lived token from Convex,
// zips them in the browser and saves the result. Returns false if the user cancelled.
export async function downloadAttachments(
  items: DownloadItem[],
  getToken: () => Promise<string>,
  onProgress: (p: DownloadProgress) => void,
): Promise<boolean> {
  if (items.length === 0) return true;
  const names = uniqueFilenames(items.map((i) => i.filename));
  const zipName = `gmail-attachments-${new Date().toISOString().slice(0, 10)}.zip`;

  // The save dialog must open while the click is still "fresh", before any awaits.
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  let writable: WritableStream | undefined;
  if (picker && items.length > 1) {
    try {
      writable = await (await picker({ suggestedName: zipName })).createWritable();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return false;
      writable = undefined; // Picker refused (e.g. inside an iframe): fall back to a Blob download.
    }
  }

  let token = getToken();
  const progress: DownloadProgress = { done: 0, total: items.length, bytes: 0, failed: [] };
  onProgress({ ...progress });

  async function fetchBytes(item: DownloadItem): Promise<Uint8Array<ArrayBuffer>> {
    const url = `${GMAIL}/messages/${item.messageId}/attachments/${item.attachmentId}`;
    for (let attempt = 0; ; attempt++) {
      const current = token;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${await current}` } });
      if (res.ok) {
        const { data } = (await res.json()) as { data: string };
        return base64UrlToBytes(data);
      }
      if (attempt >= 3) throw new Error(`${res.status}`);
      if (res.status === 401) {
        if (token === current) token = getToken(); // one shared refresh for all workers
      } else if (res.status === 429 || res.status >= 500) {
        await sleep(500 * 2 ** attempt);
      } else {
        throw new Error(`${res.status}`);
      }
    }
  }

  const tracked = (item: DownloadItem, name: string) =>
    fetchBytes(item).then(
      (bytes) => {
        progress.done++;
        progress.bytes += bytes.byteLength;
        onProgress({ ...progress });
        return bytes;
      },
      () => {
        progress.done++;
        progress.failed.push(name);
        onProgress({ ...progress });
        return null;
      },
    );

  if (items.length === 1) {
    const item = items[0]!;
    const bytes = await tracked(item, names[0]!);
    if (bytes) saveBlob(new Blob([bytes], { type: item.mimeType }), names[0]!);
    return true;
  }

  // Keep PARALLEL downloads in flight while the zip consumes files in order.
  async function* files() {
    const queue: Promise<Uint8Array<ArrayBuffer> | null>[] = [];
    let next = 0;
    const fill = () => {
      while (queue.length < PARALLEL && next < items.length) {
        queue.push(tracked(items[next]!, names[next]!));
        next++;
      }
    };
    fill();
    for (let i = 0; i < items.length; i++) {
      const bytes = await queue.shift()!;
      fill();
      if (bytes) yield { name: names[i]!, input: bytes, lastModified: new Date(items[i]!.date) };
    }
    if (progress.failed.length) {
      yield {
        name: "_failed-downloads.txt",
        input: `These attachments could not be downloaded:\n${progress.failed.join("\n")}\n`,
      };
    }
  }

  const zip = downloadZip(files());
  if (writable) await zip.body!.pipeTo(writable);
  else saveBlob(await zip.blob(), zipName);
  return true;
}
