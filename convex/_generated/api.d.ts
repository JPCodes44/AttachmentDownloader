/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as attachments from "../attachments.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as crypto from "../crypto.js";
import type * as gmail from "../gmail.js";
import type * as gmailApi from "../gmailApi.js";
import type * as http from "../http.js";
import type * as limits from "../limits.js";
import type * as parts from "../parts.js";
import type * as scans from "../scans.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  attachments: typeof attachments;
  auth: typeof auth;
  crons: typeof crons;
  crypto: typeof crypto;
  gmail: typeof gmail;
  gmailApi: typeof gmailApi;
  http: typeof http;
  limits: typeof limits;
  parts: typeof parts;
  scans: typeof scans;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
