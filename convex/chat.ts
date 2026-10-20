import { ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { ChatNotAvailableError, chatEnabled, listSpaces } from "./chatApi";
import { spaceLabel } from "./chatParts";
import { limitedAccessToken } from "./gmail";
import { MAX_CHAT_SPACES } from "./limits";

// DMs and most group chats have no name in the Chat API, so only named ones can be picked one by one.
export type ChatSpaceOption = { name: string; label: string; type: string; named: boolean };

// The user's chats, for picking which ones a Chat search reads.
export const listChatSpaces = action({
  args: {},
  handler: async (ctx): Promise<ChatSpaceOption[]> => {
    if (!chatEnabled()) throw new ConvexError("CHAT_UNAVAILABLE");
    const { accessToken } = await limitedAccessToken(ctx);
    const out: ChatSpaceOption[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const page = await listSpaces(accessToken, pageToken);
        for (const s of page.spaces ?? []) {
          out.push({ name: s.name, label: spaceLabel(s), type: s.spaceType ?? "SPACE", named: !!s.displayName });
        }
        pageToken = page.nextPageToken;
      } while (pageToken && out.length < MAX_CHAT_SPACES);
    } catch (err) {
      if (err instanceof ChatNotAvailableError) throw new ConvexError("CHAT_UNAVAILABLE");
      throw err;
    }
    return out.slice(0, MAX_CHAT_SPACES).sort((a, b) => a.label.localeCompare(b.label));
  },
});
