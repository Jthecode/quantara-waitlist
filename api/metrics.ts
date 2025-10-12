// api/metrics.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
// NodeNext: keep .js suffix for type-only import
import type { GetMetricsResponse, ISODateString } from '../types/api.js';
import { neon } from '@neondatabase/serverless';

/* CORS */
function setCors(req: VercelRequest, res: VercelResponse) {
  const allow =
    process.env.ALLOWED_ORIGINS ||
    process.env.CORS_ALLOWED_ORIGINS ||
    process.env.APP_URL ||
    '*';

  const origin = (req.headers.origin as string) || '';
  const list = allow.split(',').map(s => s.trim()).filter(Boolean);
  const allowedOrigin = list.includes('*')
    ? (origin || '*')
    : (list.includes(origin) ? origin : (list[0] || '*'));

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/* Small helpers */
async function fetchJSON<T>(url: string, ms = 1500): Promise<T | null> {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return await Promise.race<T>([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        onTimeout?.();
        reject(new Error('timeout'));
      }, ms),
    ),
  ]);
}

/* Handler */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'HEAD') {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=600');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=600');

  const now = new Date();

  // Defaults (safe when DB/env missing)
  let waitlistCount = 0;
  let countryCount  = 0;

  // Count from your schema (user_account + country)
  const DATABASE_URL = process.env.DATABASE_URL;
  if (DATABASE_URL) {
    try {
      const sql = neon(DATABASE_URL);
      const rows = await withTimeout(
        sql/* sql */`
          SELECT
            (SELECT COUNT(*)::int FROM public.user_account) AS total,
            (
              SELECT COUNT(DISTINCT NULLIF(TRIM(country), ''))::int
              FROM public.user_account
            ) AS countries
        `,
        1500,
        () => console.warn('[metrics] neon query timeout'),
      );
      const row = (rows as any)?.[0] ?? {};
      waitlistCount = Number.isFinite(+row.total) ? Number(row.total) : 0;
      countryCount  = Number.isFinite(+row.countries) ? Number(row.countries) : 0;
    } catch (e) {
      console.warn('[metrics] neon query failed:', e instanceof Error ? e.message : e);
    }
  }

  // Optional node metrics
  let height = 0;
  let peers  = 0;
  if (process.env.NODE_METRICS_URL) {
    type NodeMetrics = { height?: number; peers?: number };
    const nm = await fetchJSON<NodeMetrics>(process.env.NODE_METRICS_URL);
    if (nm) {
      if (typeof nm.height === 'number' && Number.isFinite(nm.height)) height = nm.height;
      if (typeof nm.peers  === 'number' && Number.isFinite(nm.peers))  peers  = nm.peers;
    }
  }

  const parseNum = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const avgBlockSeconds = parseNum(process.env.AVG_BLOCK_SECONDS, 6);
  const ss58Prefix      = parseNum(process.env.SS58_PREFIX, 73);

  const payload: GetMetricsResponse = {
    ok: true,
    data: {
      waitlistCount,
      countryCount,
      avgBlockSeconds,
      ss58Prefix,
      height,
      peers,
      updatedAt: now.toISOString() as ISODateString,
    },
  };

  return res.status(200).json(payload);
}
