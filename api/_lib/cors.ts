// api/_lib/cors.ts (Fetch-style helpers)

const raw =
  process.env.CORS_ALLOWED_ORIGINS ??
  process.env.ALLOWED_ORIGINS ??
  process.env.APP_URL ??
  '*';

export const ALLOWLIST = raw.split(',').map(s => s.trim()).filter(Boolean);

/** Decide which origin to return */
function resolveAllowOrigin(requestOrigin?: string): string | undefined {
  if (!ALLOWLIST.length) return '*';
  if (ALLOWLIST.includes('*')) return requestOrigin || '*';
  if (requestOrigin && ALLOWLIST.includes(requestOrigin)) return requestOrigin;
  // Fallback to first allowed origin (useful when request has no Origin header, e.g., curl)
  return ALLOWLIST[0];
}

type CorsOpts = {
  /** Enable credentials (cookies / Authorization). If true, we cannot use '*'. */
  credentials?: boolean;
  /** Seconds to cache the preflight response */
  maxAgeSeconds?: number;
};

/** Mutates headers with CORS fields */
export function withCorsHeaders(
  headers: Headers,
  origin?: string,
  opts: CorsOpts = {}
) {
  const { credentials = false, maxAgeSeconds = 600 } = opts;

  const allowOrigin = resolveAllowOrigin(origin);

  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  headers.set('Access-Control-Max-Age', String(maxAgeSeconds));

  if (credentials) {
    headers.set('Access-Control-Allow-Credentials', 'true');
    // When credentials are allowed, we must NOT return '*'
    if (allowOrigin && allowOrigin !== '*') {
      headers.set('Access-Control-Allow-Origin', allowOrigin);
    }
  } else {
    // No credentials: '*' is fine
    if (allowOrigin) headers.set('Access-Control-Allow-Origin', allowOrigin);
  }
}

/** Preflight (OPTIONS) helper */
export function preflight(origin?: string, opts?: CorsOpts) {
  const h = new Headers();
  withCorsHeaders(h, origin, opts);
  return new Response(null, { status: 204, headers: h });
}
