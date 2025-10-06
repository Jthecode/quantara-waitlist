/**
 * Quantara Devnet-0 • internal use only
 * (c) 2025 Quantara Technology LLC
 * File: api/verify-email.ts
 *
 * Purpose:
 *   Confirms a user's email via JWT token and logs a `VERIFIED` referral_event
 *   (so referrers earn points on the leaderboard). Idempotent.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.serverless.js'; // ← ESM/NodeNext requires .js

// ─────────────────────────────────────────────────────────────────────────────
// CORS (adjust origin as needed)
// ─────────────────────────────────────────────────────────────────────────────
function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Normalize drizzle execute result (array for neon-http, { rows } for pg)
function getRows(execResult: any) {
  return Array.isArray(execResult) ? execResult : execResult?.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
    const token =
      (req.query.token as string) ||
      (typeof body === 'object' && (body as any)?.token) ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice('Bearer '.length)
        : undefined);

    if (!token) return res.status(400).json({ ok: false, error: 'Missing token' });
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ ok: false, error: 'Server misconfig: JWT_SECRET' });
    }

    // Verify the token produced by /api/waitlist.ts
    let payload: any;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    }

    const userId = payload?.sub as string | undefined;
    if (!userId) return res.status(400).json({ ok: false, error: 'Invalid token payload' });

    const db = await getDb();

    // Ensure user exists
    const userQ = sql<{ id: string; email: string }>`
      SELECT id, email
        FROM user_account
       WHERE id = ${userId}
       LIMIT 1
    `;
    const userRows = getRows(await db.execute(userQ));
    const user = userRows?.[0];
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });

    // Find the most recent JOINED referrer (if any).
    const refQ = sql<{ referrer_id: string }>`
      SELECT referrer_id
        FROM referral_event
       WHERE referee_id = ${user.id}
         AND kind = 'JOINED'
       ORDER BY created_at DESC
       LIMIT 1
    `;
    const refRows = getRows(await db.execute(refQ));
    const ref = refRows?.[0];

    if (ref?.referrer_id) {
      // Insert a VERIFIED event once; ignore duplicates.
      const ins = sql`
        INSERT INTO referral_event (referrer_id, referee_id, kind)
        VALUES (${ref.referrer_id}, ${user.id}, 'VERIFIED')
        ON CONFLICT DO NOTHING
      `;
      await db.execute(ins);
    }

    // (Optional) If you add an `email_verified_at` column later, update it here.
    // await db.execute(sql`UPDATE user_account SET email_verified_at = now() WHERE id = ${user.id} AND email_verified_at IS NULL`);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      message: 'Email verified',
      awarded: Boolean(ref?.referrer_id) || false,
    });
  } catch (err) {
    console.error('[verify-email] error:', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}
