// Thin wrappers over the Google Chat REST API (user auth). No Convex imports, so tests can stub fetch.
import { GoogleApiError, googleGet } from "./gmailApi";
import type { ChatMessage, ChatSpace } from "./chatParts";

const CHAT = { name: "Chat", base: "https://chat.googleapis.com/v1" };

export const CHAT_SCOPES = [
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.messages.readonly",
];

// Off until Google approves the Chat and Drive scopes: set GOOGLE_CHAT=on on the deployment.
export const chatEnabled = () => process.env.GOOGLE_CHAT === "on";

// Asked for with Chat so files shared from Drive into a chat can be downloaded too.
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

// Personal Google accounts, and Workspace orgs with Chat turned off, can't use the Chat API.
export class ChatNotAvailableError extends Error {
  constructor() {
    super("Google Chat isn't available for this account.");
  }
}

export type SpaceList = { spaces?: ChatSpace[]; nextPageToken?: string };
export type ChatMessageList = { messages?: ChatMessage[]; nextPageToken?: string };

export async function listSpaces(accessToken: string, pageToken?: string): Promise<SpaceList> {
  try {
    return await googleGet<SpaceList>(CHAT, accessToken, "/spaces", {
      pageSize: "1000",
      fields: "spaces(name,displayName,spaceType),nextPageToken",
      ...(pageToken ? { pageToken } : {}),
    });
  } catch (err) {
    if (err instanceof GoogleApiError && err.status === 403) throw new ChatNotAvailableError();
    throw err;
  }
}

export function listSpaceMessages(accessToken: string, space: string, filter: string, pageToken?: string) {
  // 200 keeps one page's attachments well inside a mutation's argument limits.
  return googleGet<ChatMessageList>(CHAT, accessToken, `/${space}/messages`, {
    pageSize: "200",
    fields: "messages(name,createTime,text,attachment),nextPageToken",
    ...(filter ? { filter } : {}),
    ...(pageToken ? { pageToken } : {}),
  });
}
