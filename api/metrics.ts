// api/metrics.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
// NOTE: with NodeNext you need a .js extension on relative imports
import type { GetMetricsResponse, ISODateString } from '../types/api.js';

import { neon } from '@neondatabase/serverless';

// Tiny JSON fetch with timeout (optional node metrics)
async function fetchJSON<T>(url: string, ms = 1500): Promise<T | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  // CDN cache for Vercel: 60s, allow SWR for 10m
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');

  const now = new Date();

  let waitlistCount = 0;
  let countryCount = 0;

  // --- Neon (optional) ---
  const DATABASE_URL = process.env.DATABASE_URL;
  if (DATABASE_URL) {
    try {
      const sql = neon(DATABASE_URL);

      // No generic — keep it simple and coerce below
      const rows = await sql/* sql */`
        SELECT
          (SELECT COUNT(*) FROM waitlist) AS total,
          (SELECT COUNT(DISTINCT NULLIF(TRIM(country), '')) FROM waitlist) AS countries
      `;

      const row = (rows as any)?.[0] ?? {};
      waitlistCount = Number(row.total ?? 0);
      countryCount  = Number(row.countries ?? 0);
    } catch {
      // swallow and keep defaults
    }
  }

  // --- Optional node metrics (height/peers) ---
  let height: number | undefined;
  let peers: number | undefined;

  if (process.env.NODE_METRICS_URL) {
    type NodeMetrics = { height?: number; peers?: number };
    const nm = await fetchJSON<NodeMetrics>(process.env.NODE_METRICS_URL);
    if (nm) {
      if (typeof nm.height === 'number') height = nm.height;
      if (typeof nm.peers === 'number')  peers  = nm.peers;
    }
  }

  const avgBlockSeconds = Number(process.env.AVG_BLOCK_SECONDS ?? 6);
  const ss58Prefix      = Number(process.env.SS58_PREFIX ?? 73);

  const payload: GetMetricsResponse = {
    ok: true,
    data: {
      waitlistCount,
      countryCount,
      avgBlockSeconds,
      ss58Prefix,
      height,
      peers,
      updatedAt: now.toISOString() as ISODateString, // brand to ISODateString
    },
  };

  res.status(200).json(payload);
}
