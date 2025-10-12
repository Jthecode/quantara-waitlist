// public/scripts/api-client.ts
// Tiny typed client for your serverless endpoints.
// Build step: transpile to JS (esbuild/tsup) and include the compiled file with:
// <script type="module" src="/scripts/api-client.js"></script>

import type {
  ApiResponse,
  GetResponse,
  PostResponse,
  EndpointMap,
  PostEndpointMap,
  FetchJsonOptions,
  JSONObject,
} from "../../types/api.js"; // NOTE: .js suffix required with NodeNext

// ---------- Type helpers ----------------------------------------------------
type Ok<T> = T extends { ok: true } ? T : never;
type OkData<T> = T extends { ok: true; data: infer D } ? D : never;
// If a route already returns ApiResponse<…>, keep it; otherwise wrap at compile-time.
type AsApiResponse<T> = T extends { ok: boolean } ? T : ApiResponse<T>;

// ---------- Timeout helper --------------------------------------------------
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

function looksLikeApiResponse(x: unknown): x is ApiResponse<unknown> {
  return !!x && typeof x === "object" && "ok" in (x as any) && typeof (x as any).ok === "boolean";
}

// ---------- Core fetcher: always returns ApiResponse shape on 2xx -----------
async function doFetch<TExpected>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<AsApiResponse<TExpected>> {
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

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
  }

  if (!res.ok) {
    const msg =
      (parsed as any)?.error ??
      (parsed as any)?.message ??
      `${res.status}${res.statusText ? " " + res.statusText : ""}`;
    const err = new Error(msg);
    (err as any).status = res.status;
    throw err;
  }

  // Normalize success: wrap bare JSON into { ok:true, data: … }
  const normalized: ApiResponse<unknown> = looksLikeApiResponse(parsed)
    ? (parsed as ApiResponse<unknown>)
    : ({ ok: true, data: parsed } as const);

  return normalized as AsApiResponse<TExpected>;
}

// ---------- Public helpers: return success .data only -----------------------
export async function get<Path extends keyof EndpointMap>(
  path: Path,
  opts: Omit<FetchJsonOptions, "method" | "body"> & { timeoutMs?: number } = {}
): Promise<OkData<AsApiResponse<GetResponse<Path>>>> {
  const res = await doFetch<GetResponse<Path>>(path as string, { method: "GET", ...opts });
  return (res as Ok<AsApiResponse<GetResponse<Path>>>).data as OkData<
    AsApiResponse<GetResponse<Path>>
  >;
}

export async function post<Path extends keyof PostEndpointMap, Body extends JSONObject>(
  path: Path,
  body: Body,
  opts: Omit<FetchJsonOptions<Body>, "method" | "body"> & { timeoutMs?: number } = {}
): Promise<OkData<AsApiResponse<PostResponse<Path>>>> {
  const res = await doFetch<PostResponse<Path>>(path as string, {
    method: "POST",
    body: JSON.stringify(body),
    ...opts,
  });
  return (res as Ok<AsApiResponse<PostResponse<Path>>>).data as OkData<
    AsApiResponse<PostResponse<Path>>
  >;
}

// ---------- DOM hydrators (resilient to optional fields) --------------------
export async function hydrateConfig() {
  const cfg = await get("/api/config");

  const rpcEl = document.getElementById("rpc-url");
  if (rpcEl && (cfg as any)?.rpcWS) (rpcEl as HTMLElement).textContent = (cfg as any).rpcWS;

  const badge = document.getElementById("live-badge");
  if (badge) badge.textContent = "Preview";

  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  ["preview-release-time", "preview-release-time-2"].forEach((id) => {
    const t = document.getElementById(id) as HTMLTimeElement | null;
    const iso = (cfg as any)?.releaseAt;
    if (t && typeof iso === "string") {
      t.dateTime = iso;
      t.textContent = fmt.format(new Date(iso));
    }
  });

  return cfg;
}

export async function hydrateMetrics() {
  const m = await get("/api/metrics");

  const height = document.getElementById("height");
  if (height && typeof (m as any)?.height === "number")
    height.textContent = (m as any).height.toLocaleString();

  const peers = document.getElementById("peers");
  if (peers && typeof (m as any)?.peers === "number")
    peers.textContent = String((m as any).peers);

  const map: Record<string, number | undefined> = {
    waitlist: (m as any)?.waitlistCount,
    countries: (m as any)?.countryCount,
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

// ---------- Optional: expose on window --------------------------------------
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
