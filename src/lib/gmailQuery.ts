// Turns the quick filters into a Gmail search string (the same syntax as Gmail's search box).

export const FILE_TYPES = {
  pdf: { label: "PDF", extensions: ["pdf"] },
  images: { label: "Images", extensions: ["jpg", "jpeg", "png", "gif", "heic", "webp"] },
  docs: { label: "Documents", extensions: ["doc", "docx", "odt", "rtf", "txt"] },
  sheets: { label: "Spreadsheets", extensions: ["xls", "xlsx", "csv", "ods"] },
  slides: { label: "Slides", extensions: ["ppt", "pptx", "key", "odp"] },
  archives: { label: "Archives", extensions: ["zip", "rar", "7z", "tar", "gz"] },
} as const;

export type FileTypeKey = keyof typeof FILE_TYPES;

export type Filters = {
  text: string;
  from: string;
  after: string; // YYYY-MM-DD from <input type="date">
  before: string;
  label: string;
  fileTypes: FileTypeKey[];
  largerThanMb: string;
};

export const EMPTY_FILTERS: Filters = {
  text: "",
  from: "",
  after: "",
  before: "",
  label: "",
  fileTypes: [],
  largerThanMb: "",
};

export function extensionsFor(types: FileTypeKey[]): string[] {
  return types.flatMap((t) => [...FILE_TYPES[t].extensions]);
}

const quote = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, "")}"` : s);
const gmailDate = (iso: string) => iso.replace(/-/g, "/");

export function buildQuery(f: Filters): string {
  const parts: string[] = [];
  if (f.text.trim()) parts.push(f.text.trim());
  if (f.from.trim()) parts.push(`from:${quote(f.from.trim())}`);
  if (f.after) parts.push(`after:${gmailDate(f.after)}`);
  if (f.before) parts.push(`before:${gmailDate(f.before)}`);
  if (f.label) parts.push(`label:${quote(f.label.replace(/\s+/g, "-"))}`);
  const exts = extensionsFor(f.fileTypes);
  if (exts.length === 1) parts.push(`filename:${exts[0]}`);
  if (exts.length > 1) parts.push(`{${exts.map((e) => `filename:${e}`).join(" ")}}`);
  const mb = Number(f.largerThanMb);
  if (f.largerThanMb && mb > 0) parts.push(`larger:${mb}M`);
  parts.push("has:attachment");
  return parts.join(" ");
}
