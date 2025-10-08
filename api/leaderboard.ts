/* ============================================================================
   Quantara • Devnet-0 • API: leaderboard
   - ESM (NodeNext) compatible
   - CORS: GET/OPTIONS
   - Returns weekly/monthly/all-time referral points (SIGNUP + VERIFIED)
   ========================================================================== */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.serverless.js';

/** CORS: allow a comma-separated list in ALLOWED_ORIGINS (fallback: APP_URL or '*') */
function setCors(req: VercelRequest, res: VercelResponse) {
  const allowEnv =
    process.env.ALLOWED_ORIGINS ||
    process.env.CORS_ALLOWED_ORIGINS ||
    process.env.APP_URL ||
    '*';
  const list = allowEnv.split(',').map(s => s.trim()).filter(Boolean);
  const origin = (req.headers.origin as string) || '';
  const allowedOrigin = list.includes('*')
    ? origin || '*'
    : (list.includes(origin) ? origin : list[0] || '*');

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

/** Normalize drizzle execute result (array for neon-http, { rows } for pg) */
function getRows(execResult: any) {
  return Array.isArray(execResult) ? execResult : execResult?.rows;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const db = await getDb();

    // time window: week | month | all (default: week)
    const windowQ = (req.query.window as string | undefined)?.toLowerCase() ?? 'week';
    const windowSql =
      windowQ === 'month'
        ? sql`date_trunc('month', now())`
        : windowQ === 'all'
        ? sql`to_timestamp(0)` // epoch start = all-time
        : sql`date_trunc('week', now())`;

    // limit and minimum points filters
    const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 20) || 20));
    const min = Math.max(0, Number(req.query.min ?? 0) || 0);

    // weights: ?w=1,2 => SIGNUP weight=1, VERIFIED weight=2 (defaults)
    const weights = String(req.query.w ?? '1,2').split(',').map(n => Number(n));
    const wSignup = Number.isFinite(weights[0]) ? weights[0] : 1;
    const wVerified = Number.isFinite(weights[1]) ? weights[1] : 2;

    type Row = {
      referral_code: string;
      name: string;
      signups: number;
      verified: number;
      points: number;
    };

    // leaderboard: only users with a code; mask email; score both kinds
    const q = sql<Row>`
      SELECT
        u.referral_code,
        left(u.email, 3) || '***' AS name,
        COALESCE(COUNT(*) FILTER (WHERE r.kind = 'SIGNUP'   AND r.created_at >= ${windowSql}), 0)::int AS signups,
        COALESCE(COUNT(*) FILTER (WHERE r.kind = 'VERIFIED' AND r.created_at >= ${windowSql}), 0)::int AS verified,
        (
          COALESCE(COUNT(*) FILTER (WHERE r.kind = 'SIGNUP'   AND r.created_at >= ${windowSql}), 0) * ${wSignup} +
          COALESCE(COUNT(*) FILTER (WHERE r.kind = 'VERIFIED' AND r.created_at >= ${windowSql}), 0) * ${wVerified}
        )::int AS points
      FROM user_account u
      LEFT JOIN referral_event r ON r.referrer_id = u.id
      WHERE u.referral_code IS NOT NULL
      GROUP BY u.id
      HAVING (
        COALESCE(COUNT(*) FILTER (WHERE r.kind = 'SIGNUP'   AND r.created_at >= ${windowSql}), 0) * ${wSignup} +
        COALESCE(COUNT(*) FILTER (WHERE r.kind = 'VERIFIED' AND r.created_at >= ${windowSql}), 0) * ${wVerified}
      ) >= ${min}
      ORDER BY points DESC NULLS LAST, verified DESC, signups DESC, u.created_at ASC
      LIMIT ${limit}
    `;

    const execResult = await db.execute(q);
    const rows = getRows(execResult) ?? [];

    // Brief public cache; SWR for speed
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');

    return res.status(200).json({
      ok: true,
      window: windowQ,
      weights: { signup: wSignup, verified: wVerified },
      data: rows,
    });
  } catch (err) {
    console.error('[leaderboard] error:', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}
