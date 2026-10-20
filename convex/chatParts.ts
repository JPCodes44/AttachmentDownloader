// Pure helpers that turn Google Chat API messages into attachment metadata.
import type { AttachmentMeta } from "./parts";

export type ChatSpace = {
  name: string;
  displayName?: string;
  spaceType?: "SPACE" | "GROUP_CHAT" | "DIRECT_MESSAGE" | string;
};

export type ChatAttachment = {
  name?: string;
  contentName?: string;
  contentType?: string;
  source?: "UPLOADED_CONTENT" | "DRIVE_FILE" | string;
  attachmentDataRef?: { resourceName?: string };
  driveDataRef?: { driveFileId?: string };
};

export type ChatMessage = {
  name: string;
  createTime?: string;
  text?: string;
  attachment?: ChatAttachment[];
};

const SUBJECT_LENGTH = 80;
const SAFE_RESOURCE = /^[A-Za-z0-9_\-+=.\/]+$/;

// Google Docs, Sheets, Slides and Drawings have no file to download; Drive exports them instead.
const DRIVE_EXPORTS: Record<string, { mimeType: string; ext: string }> = {
  "application/vnd.google-apps.document": {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: "docx",
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: "pptx",
  },
  "application/vnd.google-apps.drawing": { mimeType: "image/png", ext: "png" },
};

// A Drive file as an attachment row: attachmentId is "drive/<id>" for a file to
// download as is, or "drive-export/<id>" for a Google file to export as mimeType.
// Null for Google types that can't be exported (Forms, folders, shortcuts…).
export function driveFile(
  fileId: string,
  name: string,
  contentType: string | undefined,
): { attachmentId: string; filename: string; mimeType: string } | null {
  const type = contentType ?? "";
  if (!type.startsWith("application/vnd.google-apps.")) {
    return { attachmentId: `drive/${fileId}`, filename: name, mimeType: type || "application/octet-stream" };
  }
  const exp = DRIVE_EXPORTS[type];
  if (!exp) return null;
  const filename = name.toLowerCase().endsWith(`.${exp.ext}`) ? name : `${name}.${exp.ext}`;
  return { attachmentId: `drive-export/${fileId}`, filename, mimeType: exp.mimeType };
}

export function spaceLabel(space: Pick<ChatSpace, "displayName" | "spaceType">): string {
  if (space.displayName) return space.displayName;
  return space.spaceType === "DIRECT_MESSAGE" ? "Direct message" : "Group chat";
}

function snippet(text: string | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > SUBJECT_LENGTH ? `${t.slice(0, SUBJECT_LENGTH - 1)}…` : t;
}

// Uploaded files become rows. So do files shared from Drive, when the token can read
// Drive; otherwise (or when they can't be exported) they are only counted.
export function extractChatAttachments(
  message: ChatMessage,
  from: string,
  driveAccess = false,
): { attachments: AttachmentMeta[]; driveFiles: number } {
  const attachments: AttachmentMeta[] = [];
  let driveFiles = 0;
  const date = message.createTime ? Date.parse(message.createTime) || 0 : 0;
  const row = (file: { attachmentId: string; filename: string; mimeType: string }) =>
    attachments.push({
      messageId: message.name,
      ...file,
      size: 0, // the Chat API doesn't report file sizes
      from,
      subject: snippet(message.text),
      date,
      isInline: false,
    });
  for (const a of message.attachment ?? []) {
    const resourceName = a.attachmentDataRef?.resourceName;
    const driveFileId = a.driveDataRef?.driveFileId;
    if (a.source === "DRIVE_FILE" || (!resourceName && driveFileId)) {
      const file = driveAccess && driveFileId ? driveFile(driveFileId, a.contentName || "file", a.contentType) : null;
      if (file) row(file);
      else driveFiles++;
      continue;
    }
    // Google issues these; refuse anything that could change the media URL's path or query.
    if (!resourceName || !SAFE_RESOURCE.test(resourceName) || resourceName.split("/").includes("..")) continue;
    row({
      attachmentId: resourceName,
      filename: a.contentName || "attachment",
      mimeType: a.contentType || "application/octet-stream",
    });
  }
  return { attachments, driveFiles };
}

// The Chat API's messages.list filter, which only supports createTime. Bounds are epoch ms.
export function chatFilter(after?: number, before?: number): string {
  const parts: string[] = [];
  if (after !== undefined) parts.push(`createTime > "${new Date(after).toISOString()}"`);
  if (before !== undefined) parts.push(`createTime < "${new Date(before).toISOString()}"`);
  return parts.join(" AND ");
}
