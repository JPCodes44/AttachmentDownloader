import { describe, expect, test } from "bun:test";
import { chatFilter, type ChatMessage, driveFile, extractChatAttachments, spaceLabel } from "../convex/chatParts";

describe("extractChatAttachments", () => {
  const message: ChatMessage = {
    name: "spaces/A/messages/m1",
    createTime: "2026-03-01T10:00:00.000Z",
    text: "Here are the   slides\nfor tomorrow",
    attachment: [
      {
        contentName: "deck.pdf",
        contentType: "application/pdf",
        source: "UPLOADED_CONTENT",
        attachmentDataRef: { resourceName: "spaces/A/attachments/x1" },
      },
      {
        contentName: "Budget",
        contentType: "application/vnd.google-apps.spreadsheet",
        source: "DRIVE_FILE",
        driveDataRef: { driveFileId: "d1" },
      },
    ],
  };

  test("uploaded files become rows; Drive files are only counted", () => {
    expect(extractChatAttachments(message, "Design team")).toEqual({
      attachments: [
        {
          messageId: "spaces/A/messages/m1",
          attachmentId: "spaces/A/attachments/x1",
          filename: "deck.pdf",
          mimeType: "application/pdf",
          size: 0,
          from: "Design team",
          subject: "Here are the slides for tomorrow",
          date: Date.parse("2026-03-01T10:00:00.000Z"),
          isInline: false,
        },
      ],
      driveFiles: 1,
    });
  });

  test("with Drive access, Drive files become rows; Google Docs are exported", () => {
    const { attachments, driveFiles } = extractChatAttachments(message, "Design team", true);
    expect(driveFiles).toBe(0);
    expect(attachments.map((a) => [a.attachmentId, a.filename, a.mimeType])).toEqual([
      ["spaces/A/attachments/x1", "deck.pdf", "application/pdf"],
      [
        "drive-export/d1",
        "Budget.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
    ]);
  });

  test("Drive files download as is, export, or can't be downloaded", () => {
    expect(driveFile("f", "scan.pdf", "application/pdf")).toEqual({
      attachmentId: "drive/f",
      filename: "scan.pdf",
      mimeType: "application/pdf",
    });
    expect(driveFile("f", "Notes.docx", "application/vnd.google-apps.document")?.filename).toBe("Notes.docx");
    expect(driveFile("f", "Survey", "application/vnd.google-apps.form")).toBeNull();
  });

  test("long message text is cut short, and messages without files give nothing", () => {
    const long = extractChatAttachments({ ...message, text: "x".repeat(200) }, "DM").attachments[0]!;
    expect(long.subject).toHaveLength(80);
    expect(long.subject.endsWith("…")).toBe(true);
    expect(extractChatAttachments({ name: "spaces/A/messages/m2", text: "hi" }, "DM")).toEqual({
      attachments: [],
      driveFiles: 0,
    });
  });

  test("spaces are labelled by name, or by kind when they have none", () => {
    expect(spaceLabel({ displayName: "Design team", spaceType: "SPACE" })).toBe("Design team");
    expect(spaceLabel({ spaceType: "DIRECT_MESSAGE" })).toBe("Direct message");
    expect(spaceLabel({ spaceType: "GROUP_CHAT" })).toBe("Group chat");
  });
});

describe("chatFilter", () => {
  test("builds createTime bounds, or nothing", () => {
    expect(chatFilter()).toBe("");
    expect(chatFilter(Date.parse("2026-01-01T00:00:00Z"))).toBe('createTime > "2026-01-01T00:00:00.000Z"');
    expect(chatFilter(Date.parse("2026-01-01T00:00:00Z"), Date.parse("2026-02-01T00:00:00Z"))).toBe(
      'createTime > "2026-01-01T00:00:00.000Z" AND createTime < "2026-02-01T00:00:00.000Z"',
    );
  });
});
