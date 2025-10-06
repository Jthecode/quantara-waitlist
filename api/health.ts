/**
 * Quantara Devnet-0 • internal use only
 * (c) 2025 Quantara Technology LLC
 * File: api/health.ts
 *
 * Purpose:
 *   Simple healthcheck that pings the database using Neon directly.
 *   Avoids driver quirks (e.g., query.getSQL) by not using Drizzle here.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({ ok: false, error: 'Missing DATABASE_URL' });
    }

    const sql = neon(process.env.DATABASE_URL);
    // Simple round trip
    const row = await sql/*sql*/`select 1 as ok, now() as ts`;
    const ok = row?.[0]?.ok === 1;

    return res.status(200).json({
      ok,
      db: ok ? 'up' : 'down',
      time: row?.[0]?.ts ?? null,
      env: process.env.NODE_ENV || 'development',
    });
  } catch (err: any) {
    console.error('[health] error:', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}
