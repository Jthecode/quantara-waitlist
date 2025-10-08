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

// ----- Internal fetcher ------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10_000;

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
  if (rest.body && typeof rest.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      headers,
      signal,
    });
  } finally {
    clear();
  }

  // Some APIs may return 204 No Content or empty body
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { ok: res.ok, status: res.status, message: text };
    }
  }

  const json = (parsed ?? { ok: res.ok, data: undefined }) as ApiResponse<unknown>;

  // Normalize errors to ApiError-like shapes and throw them
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

  // At this point `json.ok` is true
  return json as Ok<T>;
}

// ----- Public typed helpers --------------------------------------------------

// GET helper
export async function get<Path extends keyof EndpointMap>(
  path: Path,
  opts: Omit<FetchJsonOptions, "method" | "body"> & { timeoutMs?: number } = {}
): Promise<OkData<GetResponse<Path>>> {
  const res = await doFetch<GetResponse<Path>>(path as string, { method: "GET", ...opts });
  return res.data as OkData<GetResponse<Path>>;
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
  return res.data as OkData<PostResponse<Path>>;
}

// ----- Convenience: DOM hydrators (optional) --------------------------------

/** Fill small config bits in the DOM (rpc url, network name, releaseAt). */
export async function hydrateConfig() {
  const cfg = await get("/api/config");
  const rpcEl = document.getElementById("rpc-url");
  if (rpcEl) rpcEl.textContent = cfg.rpcWS;

  const badge = document.getElementById("live-badge");
  if (badge) badge.textContent = "Preview";

  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  ["preview-release-time", "preview-release-time-2"].forEach((id) => {
    const t = document.getElementById(id) as HTMLTimeElement | null;
    if (t) {
      t.dateTime = cfg.releaseAt;
      t.textContent = fmt.format(new Date(cfg.releaseAt));
    }
  });
  return cfg;
}

/** Fill live metrics in the DOM (height, peers, counters). */
export async function hydrateMetrics() {
  const m = await get("/api/metrics");

  const height = document.getElementById("height");
  if (height && typeof m.height === "number") height.textContent = m.height.toLocaleString();

  const peers = document.getElementById("peers");
  if (peers && typeof m.peers === "number") peers.textContent = String(m.peers);

  const map: Record<string, number | undefined> = {
    waitlist: m.waitlistCount,
    countries: m.countryCount,
  };

  document.querySelectorAll<HTMLElement>("[data-countup-key]").forEach((el) => {
    const key = el.getAttribute("data-countup-key")!;
    const end = map[key];
    if (typeof end !== "number") {
      el.closest("[data-hide-if-empty]")?.classList.add("hidden");
      return;
    }
    animateCountup(el, end);
  });

  return m;
}

function animateCountup(el: HTMLElement, end: number, dur = 900) {
  const start = performance.now();
  const startVal = 0;
  const step = (t: number) => {
    const k = Math.min(1, (t - start) / dur);
    const cur = Math.floor(startVal + (end - startVal) * k);
    el.textContent = cur.toLocaleString();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ----- Optional: expose on window for quick prototyping ---------------------

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
