import { describe, expect, test } from "bun:test";
import { extractAttachments, type GmailMessage } from "../convex/parts";

const headers = [
  { name: "From", value: "Alice <alice@example.com>" },
  { name: "Subject", value: "Q3 numbers" },
];

describe("extractAttachments", () => {
  test("finds attachments in nested multipart and keeps message headers", () => {
    const msg: GmailMessage = {
      id: "m1",
      internalDate: "1760000000000",
      payload: {
        mimeType: "multipart/mixed",
        headers,
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { size: 10 } },
              { mimeType: "text/html", body: { size: 20 } },
            ],
          },
          {
            mimeType: "application/pdf",
            filename: "report.pdf",
            headers: [{ name: "Content-Disposition", value: 'attachment; filename="report.pdf"' }],
            body: { attachmentId: "a1", size: 1234 },
          },
        ],
      },
    };
    expect(extractAttachments(msg)).toEqual([
      {
        messageId: "m1",
        attachmentId: "a1",
        filename: "report.pdf",
        mimeType: "application/pdf",
        size: 1234,
        from: "Alice <alice@example.com>",
        subject: "Q3 numbers",
        date: 1760000000000,
        isInline: false,
      },
    ]);
  });

  test("marks inline images and Content-ID parts as inline", () => {
    const msg: GmailMessage = {
      id: "m2",
      payload: {
        headers,
        parts: [
          {
            filename: "logo.png",
            mimeType: "image/png",
            headers: [{ name: "Content-Disposition", value: "inline" }],
            body: { attachmentId: "a1", size: 1 },
          },
          {
            filename: "sig.gif",
            mimeType: "image/gif",
            headers: [{ name: "Content-ID", value: "<sig@x>" }],
            body: { attachmentId: "a2", size: 1 },
          },
          {
            filename: "photo.jpg",
            mimeType: "image/jpeg",
            headers: [
              { name: "Content-Disposition", value: "attachment" },
              { name: "Content-ID", value: "<p@x>" },
            ],
            body: { attachmentId: "a3", size: 1 },
          },
        ],
      },
    };
    expect(extractAttachments(msg).map((a) => [a.filename, a.isInline])).toEqual([
      ["logo.png", true],
      ["sig.gif", true],
      ["photo.jpg", false],
    ]);
  });

  test("ignores parts without a filename or attachment id", () => {
    const msg: GmailMessage = {
      id: "m3",
      payload: {
        parts: [
          { filename: "", body: { attachmentId: "a1" } },
          { filename: "tiny.txt", body: { size: 5 } },
        ],
      },
    };
    expect(extractAttachments(msg)).toEqual([]);
    expect(extractAttachments({ id: "m4" })).toEqual([]);
  });
});
