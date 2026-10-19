// Pure helpers that turn a Gmail API message into attachment metadata.

export type GmailHeader = { name: string; value: string };

export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  internalDate?: string;
  payload?: GmailPart;
};

export type AttachmentMeta = {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  from: string;
  subject: string;
  date: number;
  isInline: boolean;
};

function header(headers: GmailHeader[] | undefined, name: string): string {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? "";
}

// Signature logos and pasted images: marked inline, or referenced by Content-ID.
function isInlinePart(part: GmailPart): boolean {
  const disposition = header(part.headers, "Content-Disposition").toLowerCase();
  if (disposition.startsWith("attachment")) return false;
  if (disposition.startsWith("inline")) return true;
  return header(part.headers, "Content-ID") !== "";
}

export function extractAttachments(message: GmailMessage): AttachmentMeta[] {
  const payload = message.payload;
  if (!payload) return [];
  const from = header(payload.headers, "From");
  const subject = header(payload.headers, "Subject");
  const date = Number(message.internalDate ?? 0);

  const out: AttachmentMeta[] = [];
  const walk = (part: GmailPart) => {
    const attachmentId = part.body?.attachmentId;
    if (part.filename && attachmentId) {
      out.push({
        messageId: message.id,
        attachmentId,
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body?.size ?? 0,
        from,
        subject,
        date,
        isInline: isInlinePart(part),
      });
    }
    part.parts?.forEach(walk);
  };
  walk(payload);
  return out;
}
