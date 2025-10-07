// api/verify-turnstile.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyTurnstile as _verifyTurnstile } from './_lib/turnstile.js';

// Optional CORS helper. If present at api/_lib/cors.ts exporting `cors`, we’ll use it.
// Otherwise we fall back to the inline CORS below.
let cors: ((req: VercelRequest, res: VercelResponse) => void) | null = null;
try {
  const mod = await import('./_lib/cors.js');
  // @ts-expect-error dynamic import shape at runtime
  cors = mod.cors as any;
} catch {
  cors = null;
}

function inlineCors(req: VercelRequest, res: VercelResponse) {
  const allow = process.env.ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS || '*';
  const origin = (req.headers.origin as string) || '';
  const list = allow.split(',').map((s) => s.trim()).filter(Boolean);
  const allowedOrigin = list.includes('*')
    ? origin || '*'
    : list.includes(origin)
    ? origin
    : list[0] || '*';

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (cors) cors(req, res);
  else inlineCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const token: string =
      body['cf-turnstile-response'] ||
      body['cf_turnstile_response'] ||
      body['turnstileToken'] ||
      body['token'] ||
      '';

    if (!token) return res.status(400).json({ success: false, error: 'missing_token' });

    // ✅ DEV BYPASS: if not production and token is TEST_BYPASS, short-circuit success
    if (process.env.NODE_ENV !== 'production' && token === 'TEST_BYPASS') {
      return res.status(200).json({ success: true, score: 1 });
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (req.headers['x-real-ip'] as string) ||
      undefined;

    // Prefer new helper signature (token, { ip, minScore }) then fallback to legacy (token, ip)
    let vr: any;
    try {
      vr = await (_verifyTurnstile as any)(token, { ip, minScore: 0.5 });
    } catch {
      vr = await (_verifyTurnstile as any)(token, ip);
    }

    const success: boolean = typeof vr === 'boolean' ? vr : !!vr?.success;
    const score: number | undefined = typeof vr === 'object' ? vr?.score : undefined;

    return res.status(success ? 200 : 403).json({ success, score });
  } catch (e: any) {
    return res
      .status(500)
      .json({ success: false, error: 'internal_error', detail: String(e?.message || e) });
  }
}
