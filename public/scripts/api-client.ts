// public/scripts/api-client.ts
// Tiny typed client for your serverless endpoints.
//
// Build step: transpile to JS (e.g. esbuild/tsup) and include the compiled file
// with <script type="module" src="/scripts/api-client.js"></script>

import type {
  ApiResponse,
  GetResponse,
  PostResponse,
  EndpointMap,
  PostEndpointMap,
  FetchJsonOptions,
  JSONObject,
} from "../../types/api.js"; // NOTE: .js suffix required with NodeNext

// ---------- Type helpers: pick success branch & its data --------------------
type Ok<T> = T extends { ok: true } ? T : never;
type OkData<T> = T extends { ok: true; data: infer D } ? D : never;

// ---------- Constants --------------------------------------------------------
const DEFAULT_TIMEOUT_MS = 10_000;
const nfInt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const prefersReducedMotion =
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches === true;

// ---------- Internals: fetch with timeout & sane headers ---------------------
function makeTimeoutSignal(
  upstream: AbortSignal | null | undefined,
  ms: number = DEFAULT_TIMEOUT_MS
): { signal: AbortSignal | undefined; clear: () => void } {
  if (!ms) return { signal: upstream ?? undefined, clear: () => {} };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const clear = () => clearTimeout(timer);

  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, clear };
}

async function doFetch<T extends ApiResponse<any>>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Ok<T>> {
  const { timeoutMs, ...rest } = init;
  const { signal, clear } = makeTimeoutSignal(rest.signal, timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const headers = new Headers(rest.headers || {});
  // Default to JSON accept; set Content-Type when body is string
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (rest.body && typeof rest.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      cache: rest.cache ?? "no-store",
      ...rest,
      headers,
      signal,
    });
  } finally {
    clear();
  }

  // Some APIs may return 204 No Content or an empty body — normalize that
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON: surface as a normalized error/echo body
      parsed = { ok: res.ok, status: res.status, message: text };
    }
  }

  // Accept both wrapped { ok, data } and raw payloads; we normalize below
  const json = (parsed ?? { ok: res.ok, data: undefined }) as ApiResponse<unknown>;

  if (!res.ok || (json as any).ok === false) {
    const err =
      (json as any).ok === false
        ? (json as any)
        : {
            ok: false,
            status: res.status,
            code: res.statusText || "HTTP_ERROR",
            message:
              (json as any)?.message ||
              `Request failed (${res.status}${res.statusText ? " " + res.statusText : ""})`,
          };
    throw err;
  }
  return json as Ok<T>;
}

// ---------- Public typed helpers --------------------------------------------

// GET helper
export async function get<Path extends keyof EndpointMap>(
  path: Path,
  opts: Omit<FetchJsonOptions, "method" | "body"> & { timeoutMs?: number } = {}
): Promise<OkData<GetResponse<Path>>> {
  const res = await doFetch<GetResponse<Path>>(path as string, { method: "GET", ...opts });
  return (res as any).data as OkData<GetResponse<Path>>;
}

// POST helper
export async function post<Path extends keyof PostEndpointMap, Body extends JSONObject>(
  path: Path,
  body: Body,
  opts: Omit<FetchJsonOptions<Body>, "method" | "body"> & { timeoutMs?: number } = {}
): Promise<OkData<PostResponse<Path>>> {
  const res = await doFetch<PostResponse<Path>>(path as string, {
    method: "POST",
    body: JSON.stringify(body),
    ...opts,
  });
  return (res as any).data as OkData<PostResponse<Path>>;
}

// ---------- DOM helpers (optional) ------------------------------------------
function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return (typeof document !== "undefined" ? document.getElementById(id) : null) as T | null;
}
function setText(el: HTMLElement | null, v: string | number | null | undefined) {
  if (!el) return;
  el.textContent =
    typeof v === "number" ? nfInt.format(v) : v == null || v === "" ? "—" : String(v);
}
function setTime(el: HTMLTimeElement | null, iso: string | null | undefined) {
  if (!el || !iso) return;
  const dt = new Date(iso);
  if (Number.isNaN(+dt)) return;
  el.dateTime = dt.toISOString();
  el.textContent = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(dt);
}

// ---------- Hydrators --------------------------------------------------------

/**
 * Fill small config bits in the DOM (rpc url, network name, releaseAt, SS58/decimals)
 * and toggle Live/Preview UI.
 */
export async function hydrateConfig() {
  const cfg = await get("/api/config");

  // RPC URL (code block near quick actions)
  const rpcText = byId("rpc-url");
  if (rpcText && (cfg as any).rpcWS) rpcText.textContent = String((cfg as any).rpcWS);

  // Small tokens near hero badge row
  setText(byId("ss58-prefix"), (cfg as any).ss58Prefix);
  setText(byId("token-symbol"), (cfg as any).tokenSymbol);
  setText(byId("token-decimals"), (cfg as any).tokenDecimals);

  // Also mirror into Wallet/Faucet teasers if present
  setText(byId("wallet-ss58"), (cfg as any).ss58Prefix);
  setText(byId("wallet-token"), (cfg as any).tokenSymbol);
  setText(byId("wallet-decimals"), (cfg as any).tokenDecimals);
  setText(byId("faucet-token"), (cfg as any).tokenSymbol);

  // Release gating — if releaseAt is present, show on both preview cards
  const relIso = (cfg as any).releaseAt as string | undefined;
  if (relIso) {
    setTime(byId<HTMLTimeElement>("preview-release-time"), relIso);
    setTime(byId<HTMLTimeElement>("preview-release-time-2"), relIso);

    const now = Date.now();
    const t = Date.parse(relIso);
    const live = Number.isFinite(t) && now >= t;

    // Flip global "Preview"/"Live" badge in the network strip if present
    const liveBadge = byId("live-badge");
    if (liveBadge) liveBadge.textContent = live ? "Live" : "Preview";

    // Also toggle a document-level flag other code may use
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-live", live ? "1" : "0");
    }
  }

  return cfg;
}

/** Fill live metrics in the DOM (height, peers, basic counters). */
export async function hydrateMetrics() {
  const m = await get("/api/metrics");

  // Height / peers counters
  setText(byId("height"), (m as any).height);
  setText(byId("peers"), (m as any).peers);

  // Metric tiles (IDs in the index: metric-waitlist, metric-countries, metric-avgblock, metric-ss58)
  const map: Record<string, number | undefined> = {
    "metric-waitlist": (m as any).waitlistCount,
    "metric-countries": (m as any).countryCount,
    "metric-avgblock": (m as any).avgBlockSeconds,
    "metric-ss58": (m as any).ss58Prefix,
  };

  Object.entries(map).forEach(([id, val]) => {
    const el = byId(id);
    if (!el) return;
    if (typeof val === "number") {
      animateCountup(el, val);
    } else {
      el.textContent = "—";
    }
  });

  // Any [data-countup-key] elements (e.g., “my-points”) — hydrate when available
  const counters = document.querySelectorAll<HTMLElement>("[data-countup-key]");
  counters.forEach((el) => {
    const key = el.getAttribute("data-countup-key") || "";
    let end: number | undefined;
    switch (key) {
      case "points":
        // If you later wire real points here, animate them
        end = Number(localStorage.getItem("q_points") || 0);
        break;
      default:
        end = undefined;
    }
    if (typeof end === "number" && Number.isFinite(end)) animateCountup(el, end);
  });

  return m;
}

// ---------- Countup animation (respects reduced motion) ----------------------
function animateCountup(el: HTMLElement, end: number, dur = 900) {
  if (prefersReducedMotion) {
    el.textContent = nfInt.format(end);
    return;
  }
  const start = performance.now();
  const startVal =
    Number(String(el.textContent || "").replace(/[^\d.-]/g, "")) || 0;

  function step(t: number) {
    const k = Math.min(1, (t - start) / dur);
    const cur = Math.round(startVal + (end - startVal) * k);
    el.textContent = nfInt.format(cur);
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ---------- Optional: expose on window for quick prototyping -----------------
declare global {
  interface Window {
    Api?: {
      get: typeof get;
      post: typeof post;
      hydrateConfig: typeof hydrateConfig;
      hydrateMetrics: typeof hydrateMetrics;
    };
  }
}

if (typeof window !== "undefined") {
  window.Api = { get, post, hydrateConfig, hydrateMetrics };
}
