/* ============================================================================
   Quantara • Devnet-0 • API: leaderboard
   - ESM (NodeNext) compatible
   - CORS: GET/OPTIONS
   - Returns weekly/monthly/all-time referral points (JOINED/VERIFIED)
   ========================================================================== */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.node.js'; // ← IMPORTANT: .js for NodeNext/ESM

// Simple CORS helper
function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Normalize drizzle execute result (array for neon-http, { rows } for pg)
function getRows(execResult: any) {
  return Array.isArray(execResult) ? execResult : execResult?.rows;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const db = await getDb();

    // Optional time window filter: ?window=week|month|all (default: week)
    const windowQ = (req.query.window as string)?.toLowerCase() ?? 'week';
    const windowSql =
      windowQ === 'month'
        ? sql`date_trunc('month', now())`
        : windowQ === 'all'
        ? sql`to_timestamp(0)` // epoch start = all-time
        : sql`date_trunc('week', now())`; // default week

    // Compute points (VERIFIED referrals) and mask email for public display
    const q = sql<{ referral_code: string; name: string; points: number }>`
      SELECT
        u.referral_code,
        left(u.email, 3) || '***' AS name,
        COALESCE(COUNT(*) FILTER (WHERE r.kind = 'VERIFIED'), 0)::int AS points
      FROM user_account u
      LEFT JOIN referral_event r
        ON r.referrer_id = u.id
       AND r.created_at >= ${windowSql}
      GROUP BY u.id
      ORDER BY points DESC NULLS LAST, u.created_at ASC
      LIMIT 20
    `;

    const execResult = await db.execute(q);
    const rows = getRows(execResult) ?? [];

    // Cache briefly (public)
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');

    return res.status(200).json({ ok: true, data: rows, window: windowQ });
  } catch (err) {
    console.error('leaderboard error:', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}
