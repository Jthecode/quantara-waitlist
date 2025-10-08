// public/scripts/api-client.ts
var DEFAULT_TIMEOUT_MS = 1e4;
function makeTimeoutSignal(upstream, ms = DEFAULT_TIMEOUT_MS) {
  if (!ms) return { signal: upstream ?? void 0, clear: () => {
  } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const clear = () => clearTimeout(timer);
  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, clear };
}
async function doFetch(path, init = {}) {
  const { timeoutMs, ...rest } = init;
  const { signal, clear } = makeTimeoutSignal(rest.signal, timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers = new Headers(rest.headers || {});
  if (rest.body && typeof rest.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  let res;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      headers,
      signal
    });
  } finally {
    clear();
  }
  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { ok: res.ok, status: res.status, message: text };
    }
  }
  const json = parsed ?? { ok: res.ok, data: void 0 };
  if (!res.ok || json.ok === false) {
    const err = json.ok === false ? json : {
      ok: false,
      status: res.status,
      code: res.statusText || "HTTP_ERROR",
      message: json?.message || `Request failed (${res.status}${res.statusText ? " " + res.statusText : ""})`
    };
    throw err;
  }
  return json;
}
async function get(path, opts = {}) {
  const res = await doFetch(path, { method: "GET", ...opts });
  return res.data;
}
async function post(path, body, opts = {}) {
  const res = await doFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
    ...opts
  });
  return res.data;
}
async function hydrateConfig() {
  const cfg = await get("/api/config");
  const rpcEl = document.getElementById("rpc-url");
  if (rpcEl) rpcEl.textContent = cfg.rpcWS;
  const badge = document.getElementById("live-badge");
  if (badge) badge.textContent = "Preview";
  const fmt = new Intl.DateTimeFormat(void 0, { dateStyle: "medium", timeStyle: "short" });
  ["preview-release-time", "preview-release-time-2"].forEach((id) => {
    const t = document.getElementById(id);
    if (t) {
      t.dateTime = cfg.releaseAt;
      t.textContent = fmt.format(new Date(cfg.releaseAt));
    }
  });
  return cfg;
}
async function hydrateMetrics() {
  const m = await get("/api/metrics");
  const height = document.getElementById("height");
  if (height && typeof m.height === "number") height.textContent = m.height.toLocaleString();
  const peers = document.getElementById("peers");
  if (peers && typeof m.peers === "number") peers.textContent = String(m.peers);
  const map = {
    waitlist: m.waitlistCount,
    countries: m.countryCount
  };
  document.querySelectorAll("[data-countup-key]").forEach((el) => {
    const key = el.getAttribute("data-countup-key");
    const end = map[key];
    if (typeof end !== "number") {
      el.closest("[data-hide-if-empty]")?.classList.add("hidden");
      return;
    }
    animateCountup(el, end);
  });
  return m;
}
function animateCountup(el, end, dur = 900) {
  const start = performance.now();
  const startVal = 0;
  const step = (t) => {
    const k = Math.min(1, (t - start) / dur);
    const cur = Math.floor(startVal + (end - startVal) * k);
    el.textContent = cur.toLocaleString();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
if (typeof window !== "undefined") {
  window.Api = { get, post, hydrateConfig, hydrateMetrics };
}
export {
  get,
  hydrateConfig,
  hydrateMetrics,
  post
};
//# sourceMappingURL=api-client.js.map
