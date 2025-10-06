const allow = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",").map(s => s.trim()).filter(Boolean);

export function withCorsHeaders(headers: Headers, origin?: string) {
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (origin && allow.includes(origin)) headers.set("Access-Control-Allow-Origin", origin);
}

export function preflight(origin?: string) {
  const h = new Headers();
  withCorsHeaders(h, origin);
  return new Response(null, { status: 204, headers: h });
}
