/* ============================================================================
   Quantara Devnet-0 • internal use only
   (c) 2025 Quantara Technology LLC
   File: api/waitlist.ts

   Purpose:
     Accepts waitlist joins, verifies Cloudflare Turnstile, upserts user,
     records referral JOINED events, and returns a short-lived email-verify JWT.

   Security notes:
     - CORS is limited to APP_URL (comma-separated list supported) or "*"
     - Turnstile required; rejects if verification fails
     - No sensitive data returned in response
   ========================================================================== */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import 'dotenv/config';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.serverless.js'; // or: '../db/client.node.js'

// ─────────────────────────────────────────────────────────────────────────────
// CORS helpers
// ─────────────────────────────────────────────────────────────────────────────
function getAllowedOrigins(): string[] {
  const raw = process.env.APP_URL ?? '*';
  return raw === '*' ? ['*'] : raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function setCors(req: VercelRequest, res: VercelResponse) {
  const origins = getAllowedOrigins();
  const requestOrigin = (req.headers.origin as string) || '';
  const allow =
    origins.includes('*') || origins.includes(requestOrigin) ? requestOrigin || origins[0] : origins[0];

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', allow || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
}

// Env warnings (non-fatal, but useful in dev)
(['DATABASE_URL', 'JWT_SECRET', 'TURNSTILE_SECRET_KEY'] as const).forEach((k) => {
  if (!process.env[k]) console.warn(`[waitlist] missing env ${k}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation schema
// ─────────────────────────────────────────────────────────────────────────────
const JoinSchema = z.object({
  email: z.string().email(),
  role: z.string().min(1).max(40),
  experience: z.enum(['New', 'Intermediate', 'Advanced']).optional(),
  discord: z.string().max(80).optional(),
  github: z.string().url().optional(),
  country: z.string().max(80).optional(),
  referral: z.string().max(64).optional(),
  referral_auto: z.string().max(64).optional(),
  utm_source: z.string().max(64).optional(),
  utm_medium: z.string().max(64).optional(),
  utm_campaign: z.string().max(64).optional(),
  utm_content: z.string().max(64).optional(),
  utm_term: z.string().max(64).optional(),
  // Cloudflare Turnstile token (from <form> or fetch)
  turnstileToken: z.string().min(5),
});

// ─────────────────────────────────────────────────────────────────────────────
// Turnstile verify (with dev bypass)
// ─────────────────────────────────────────────────────────────────────────────
async function verifyTurnstile(token: string, ip?: string) {
  if (process.env.NODE_ENV !== 'production' && token === 'TEST_BYPASS') return true;

  const secret = process.env.TURNSTILE_SECRET_KEY || '';
  if (!secret) return false;

  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);

  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });

  if (!r.ok) return false;
  const data = (await r.json()) as { success: boolean; ['error-codes']?: string[] };
  return data.success === true;
}

// Helpers
function makeReferralCode(email: string) {
  const seed = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${seed}${rand}`;
}

// Normalize drizzle execute result (array or { rows })
function getRows(execResult: any) {
  return Array.isArray(execResult) ? execResult : execResult?.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};

    const parsed = JoinSchema.safeParse({
      ...raw,
      turnstileToken: raw['cf-turnstile-response'] || raw['turnstileToken'] || raw['token'],
    });

    if (!parsed.success) {
      return res
        .status(400)
        .json({ ok: false, error: 'Invalid payload', details: parsed.error.flatten() });
    }

    const data = parsed.data;

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (req.headers['x-real-ip'] as string) ||
      undefined;

    const human = await verifyTurnstile(data.turnstileToken, ip);
    if (!human) return res.status(401).json({ ok: false, error: 'Human verification failed' });

    const db = await getDb();

    const refCode = data.referral?.trim() || data.referral_auto?.trim() || null;

    // Build UTM JSON client-side and pass as a single ::jsonb param (avoids 42P18 inference)
    const utmPayload = {
      source: data.utm_source ?? null,
      medium: data.utm_medium ?? null,
      campaign: data.utm_campaign ?? null,
      content: data.utm_content ?? null,
      term: data.utm_term ?? null,
    };
    const utmJson = sql`jsonb_strip_nulls(${JSON.stringify(utmPayload)}::jsonb)`;

    // Upsert user. Keep/merge referral_code + UTM JSON.
    // UTM merge rule: existing keys stay unless new non-null provided (jsonb_strip_nulls + ||).
    const upsertUser = sql<{ id: string; email: string; referral_code: string }>`
      WITH ins AS (
        INSERT INTO user_account (
          email, role, experience, discord, github, country, referral_code, utm
        )
        VALUES (
          ${data.email}, ${data.role}, ${data.experience ?? null}, ${data.discord ?? null},
          ${data.github ?? null}, ${data.country ?? null}, ${makeReferralCode(data.email)},
          ${utmJson}
        )
        ON CONFLICT (email)
        DO UPDATE SET
          role = EXCLUDED.role,
          experience = EXCLUDED.experience,
          discord = EXCLUDED.discord,
          github = EXCLUDED.github,
          country = EXCLUDED.country,
          -- merge UTM JSON, do not overwrite with nulls
          utm = jsonb_strip_nulls(user_account.utm || EXCLUDED.utm)
        RETURNING id, email, referral_code
      )
      SELECT id, email, referral_code FROM ins
    `;

    const execIns: any = await db.execute(upsertUser);
    const insRows = getRows(execIns);
    const user = insRows?.[0];
    if (!user) throw new Error('Failed to upsert user');

    // Record referral JOINED if refCode present and not self-referral
    if (refCode) {
      const logReferral = sql`
        INSERT INTO referral_event (referrer_id, referee_id, kind)
        SELECT u1.id, u2.id, 'JOINED'
        FROM user_account u1
        JOIN user_account u2 ON u2.email = ${user.email}
        WHERE u1.referral_code = ${refCode}
          AND u1.id <> u2.id
        ON CONFLICT DO NOTHING
      `;
      await db.execute(logReferral);
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, kind: 'verify-email' },
      process.env.JWT_SECRET as string,
      { expiresIn: '2d' }
    );

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      user: { email: user.email, referral_code: user.referral_code },
      verifyToken: token,
    });
  } catch (err) {
    console.error('[waitlist] error:', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}
