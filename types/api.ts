// /types/api.ts

/* ------------------------------------------------------------------ *
 * Shared primitives
 * ------------------------------------------------------------------ */

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;
export type JSONObject = { [key: string]: JSONValue };
export type JSONArray = JSONValue[];

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type ISODateString = Brand<string, "iso-date">; // e.g. 2025-11-30T17:00:00.000Z
export type WsUrl = Brand<string, "ws-url">;            // e.g. wss://rpc.devnet-0.quantara.xyz
export type HttpUrl = Brand<string, "http-url">;

/* ------------------------------------------------------------------ *
 * API envelopes (match current handlers)
 * ------------------------------------------------------------------ */

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  /** some handlers (e.g., /api/waitlist) also return meta */
  meta?: JSONObject;
}

export interface ApiError {
  ok: false;
  /** some handlers send `code`, others `error`, sometimes both */
  code?: string;
  error?: string;
  /** optional safe message for users */
  message?: string;
  /** optional HTTP status mirrored by client (not always present server-side) */
  status?: number;
  details?: JSONObject;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export const isApiError = <T>(r: ApiResponse<T>): r is ApiError => r.ok === false;
export const isApiSuccess = <T>(r: ApiResponse<T>): r is ApiSuccess<T> => r.ok === true;

/* ------------------------------------------------------------------ *
 * /api/config  → Network & site config used by the UI
 * ------------------------------------------------------------------ */

export interface ExplorerLinks {
  homepage: HttpUrl;         // e.g. "https://explorer.quantara.xyz/" or "/explorer/"
  account?: string;          // route pattern, e.g. "/account/{address}"
  tx?: string;               // route pattern, e.g. "/tx/{hash}"
}

export interface SiteLinks {
  wallet: string;            // e.g. "/wallet/"
  faucet: string;            // e.g. "/faucet/"
  status: string;            // e.g. "/status/"
  explorer: string;          // e.g. "/explorer/"
}

export interface NetworkConfig {
  chainName: string;         // "Devnet-0"
  tokenSymbol: "QTR";
  tokenDecimals: 12;
  ss58Prefix: 73;
  rpcWS: WsUrl;              // "wss://rpc.devnet-0.quantara.xyz"
  releaseAt: ISODateString;  // launch timestamp (UTC)
  explorer: ExplorerLinks;
  links: SiteLinks;
}

export type GetConfigResponse = ApiResponse<NetworkConfig>;

/* ------------------------------------------------------------------ *
 * /api/metrics  → Numbers for the homepage widgets
 * ------------------------------------------------------------------ */

export interface Metrics {
  waitlistCount: number;     // total signups
  countryCount: number;
  avgBlockSeconds: number;   // e.g. 6
  ss58Prefix: number;        // 73
  height?: number;           // optional live node metric
  peers?: number;            // optional live node metric
  updatedAt: ISODateString;
}

export type GetMetricsResponse = ApiResponse<Metrics>;

/* ------------------------------------------------------------------ *
 * /api/leaderboard  → Referral leaderboard data (matches current handler)
 * ------------------------------------------------------------------ */

export interface LeaderboardRow {
  referral_code: string;     // user's referral code
  name: string;              // masked email (e.g., "abc***")
  signups: number;           // SIGNUP events in window
  verified: number;          // VERIFIED events in window
  points: number;            // weighted points
}

export interface LeaderboardWeights {
  signup: number;
  verified: number;
}

/** current handler returns a simple string 'week' | 'month' | 'all' */
export type LeaderboardWindow = "week" | "month" | "all";

export interface LeaderboardResponseBody {
  window: LeaderboardWindow;
  weights: LeaderboardWeights;
  data: LeaderboardRow[];
}

export type GetLeaderboardResponse = ApiResponse<LeaderboardResponseBody>;

/* ------------------------------------------------------------------ *
 * /api/waitlist  → New signup (matches current handler)
 * ------------------------------------------------------------------ */

export type Role =
  | "Enthusiast (No code)"
  | "Creator"
  | "Builder"
  | "Validator"
  | "Ambassador"
  | "Partner"
  | "Press";

export type Experience = "New" | "Intermediate" | "Advanced";

export interface WaitlistRequest {
  email: string;
  role: Role;
  experience?: Experience;
  discord?: string;
  github?: string;
  country?: string;
  referral?: string;         // user-typed code
  referral_auto?: string;    // captured from URL (?ref=)
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;

  // Accept several field names; UI should use "cf-turnstile-response"
  "cf-turnstile-response"?: string;
  cf_turnstile_response?: string;
  turnstileToken?: string;

  /** optional, if your UI includes consent */
  consent_marketing?: "yes";
}

export interface WaitlistResult {
  id: string;                // server-generated id
  code: string;              // assigned referral code for sharable links
  emailQueued: boolean;      // whether verification email queued
}

/** /api/waitlist also returns { meta: { verifyToken } } */
export interface WaitlistMeta {
  verifyToken?: string;
}

export type PostWaitlistResponse = ApiSuccess<WaitlistResult> | ApiError & { meta?: WaitlistMeta };

/* ------------------------------------------------------------------ *
 * /api/verify-email → clicked from email (JSON mode)
 * ------------------------------------------------------------------ */

export interface VerifyEmailJsonResult {
  verified: boolean;
  awarded: boolean;          // whether a VERIFIED referral was awarded
  redirect: string;          // URL we would 302 to in non-JSON mode
}

export type PostVerifyEmailResponse = ApiResponse<VerifyEmailJsonResult>;

/* ------------------------------------------------------------------ *
 * /api/verify-turnstile → server-side token check (matches current handler)
 * NOTE: This endpoint currently returns a *raw* shape, not wrapped in ApiResponse.
 * ------------------------------------------------------------------ */

export interface VerifyTurnstileRawResult {
  success: boolean;
  score?: number;
}

export type PostVerifyTurnstileResponse = VerifyTurnstileRawResult; // raw passthrough

/* ------------------------------------------------------------------ *
 * /api/faucet-claim → if/when exposed
 * (kept generic; adjust when you implement the handler)
 * ------------------------------------------------------------------ */

export interface FaucetClaimRequest {
  address: string;           // SS58=73 address
  proof: string;             // Turnstile token or signed proof
}

export interface FaucetClaimResult {
  accepted: boolean;
  txHash?: string;
  reason?: string;           // if rejected (rate limit, invalid address, etc.)
}

export type PostFaucetClaimResponse = ApiResponse<FaucetClaimResult>;

/* ------------------------------------------------------------------ *
 * /api/health → simple DB ping (matches current handler)
 * ------------------------------------------------------------------ */

export interface HealthPayload {
  ok: boolean;               // true if DB ping worked
  db: "up" | "down";
  time?: string | null;      // server timestamp from DB
  env: string;               // NODE_ENV echo
}

export type GetHealthResponse = HealthPayload; // this handler is not envelope-wrapped

/* ------------------------------------------------------------------ *
 * Small helper types for fetchers on the client
 * ------------------------------------------------------------------ */

export type HttpMethod = "GET" | "POST";

export interface FetchJsonOptions<TBody extends JSONObject | undefined = undefined> {
  method?: HttpMethod;
  body?: TBody;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** GET endpoints map (types reflect the *response* you get back) */
export type EndpointMap = {
  "/api/config": GetConfigResponse;
  "/api/metrics": GetMetricsResponse;
  "/api/leaderboard": GetLeaderboardResponse;
  "/api/health": GetHealthResponse;
};

/** POST endpoints map */
export type PostEndpointMap = {
  "/api/waitlist": PostWaitlistResponse;
  "/api/verify-email": PostVerifyEmailResponse;
  "/api/verify-turnstile": PostVerifyTurnstileResponse;
  "/api/faucet-claim": PostFaucetClaimResponse;
};

/** Utility to narrow response type from a known path */
export type GetResponse<Path extends keyof EndpointMap> = EndpointMap[Path];
export type PostResponse<Path extends keyof PostEndpointMap> = PostEndpointMap[Path];
