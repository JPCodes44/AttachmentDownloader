import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

// Hard ceilings so one account (or a pile of throwaway ones) can't run up the bill.
export const MAX_MESSAGES_PER_SCAN = 25_000;
export const MAX_ATTACHMENTS_PER_SCAN = 10_000;
export const MAX_QUERY_LENGTH = 1_000;
export const MAX_EXTENSIONS = 50;
export const MAX_EXTENSION_LENGTH = 16;
// A Chat scan reads every message in every space, so cap how many spaces it walks.
export const MAX_CHAT_SPACES = 2_000;

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  startScan: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
  // getAccessToken and listLabels each hit Google's token endpoint.
  gmailToken: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 10 },
});
