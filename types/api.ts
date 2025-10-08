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
 * API envelope
 * ------------------------------------------------------------------ */

export interface ApiError {
  ok: false;
  status: number;            // HTTP status sent by the API
  code: string;              // machine-readable code (e.g., "BAD_REQUEST", "RATE_LIMITED")
  message: string;           // safe, user-facing message
  details?: JSONObject;      // optional extra context
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export const isApiError = <T>(r: ApiResponse<T>): r is ApiError => r.ok === false;
export const isApiSuccess = <T>(r: ApiResponse<T>): r is ApiSuccess<T> => r.ok === true;

/* ------------------------------------------------------------------ *
 * /api/config  → Network & site config used by the UI
 * ------------------------------------------------------------------ */

export interface ExplorerLinks {
  homepage: HttpUrl;         // e.g. "https://explorer.quantara.xyz/"
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
  waitlistCount: number;     // total signups (verified or all—your choice, document it)
  countryCount: number;
  avgBlockSeconds: number;   // e.g. 6
  ss58Prefix: number;        // 73
  height?: number;           // optional if you pipe live node metrics
  peers?: number;            // optional
  updatedAt: ISODateString;
}

export type GetMetricsResponse = ApiResponse<Metrics>;

/* ------------------------------------------------------------------ *
 * /api/leaderboard  → Referral leaderboard data
 * ------------------------------------------------------------------ */

export interface LeaderboardEntry {
  rank: number;
  handle: string;            // display name (e.g., "0xNova")
  points: number;            // points for the current window
  code?: string;             // ref code (never expose email)
}

export interface LeaderboardWindow {
  label: string;             // "weekly", "all-time", etc.
  since?: ISODateString;
  until?: ISODateString;
}

export interface LeaderboardPayload {
  window: LeaderboardWindow;
  entries: LeaderboardEntry[];
  updatedAt: ISODateString;
}

export type GetLeaderboardResponse = ApiResponse<LeaderboardPayload>;

/* ------------------------------------------------------------------ *
 * /api/waitlist  → New signup
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
  experience: Experience;
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

  // Cloudflare Turnstile token name is standardized:
  // https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
  "cf-turnstile-response": string;
  consent_marketing: "yes";  // required checkbox in your UI
}

export interface WaitlistResult {
  id: string;                // server-generated id
  code: string;              // assigned referral code for sharable links
  emailQueued: boolean;      // whether verification email queued
}

export type PostWaitlistResponse = ApiResponse<WaitlistResult>;

/* ------------------------------------------------------------------ *
 * /api/verify-email → clicked from email
 * ------------------------------------------------------------------ */

export interface VerifyEmailRequest {
  token: string;             // single-use verification token
}

export interface VerifyEmailResult {
  verified: boolean;
  code?: string;             // the user’s referral code (for redirect building)
}

export type PostVerifyEmailResponse = ApiResponse<VerifyEmailResult>;

/* ------------------------------------------------------------------ *
 * /api/verify-turnstile → optional server-side token check
 * ------------------------------------------------------------------ */

export interface VerifyTurnstileRequest {
  token: string;             // client Turnstile response
}

export interface VerifyTurnstileResult {
  valid: boolean;
  hostname?: string;
  challenge_ts?: ISODateString;
}

export type PostVerifyTurnstileResponse = ApiResponse<VerifyTurnstileResult>;

/* ------------------------------------------------------------------ *
 * /api/faucet-claim → for CI/dev tooling (if exposed)
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
 * /api/health → simple ping
 * ------------------------------------------------------------------ */

export interface Health {
  ok: true;
  uptime: number;            // seconds
  region?: string;           // Vercel region
  timestamp: ISODateString;
}

export type GetHealthResponse = ApiResponse<Health>;

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

export type EndpointMap = {
  "/api/config": GetConfigResponse;
  "/api/metrics": GetMetricsResponse;
  "/api/leaderboard": GetLeaderboardResponse;
  "/api/health": GetHealthResponse;
};

export type PostEndpointMap = {
  "/api/waitlist": PostWaitlistResponse;
  "/api/verify-email": PostVerifyEmailResponse;
  "/api/verify-turnstile": PostVerifyTurnstileResponse;
  "/api/faucet-claim": PostFaucetClaimResponse;
};

// Utility to narrow response type from a known path
export type GetResponse<Path extends keyof EndpointMap> = EndpointMap[Path];
export type PostResponse<Path extends keyof PostEndpointMap> = PostEndpointMap[Path];
