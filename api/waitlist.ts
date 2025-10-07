/* ============================================================================
   Quantara Devnet-0 • internal use only
   (c) 2025 Quantara Technology LLC
   File: api/waitlist.ts
   Purpose:
     Accepts waitlist joins, verifies Cloudflare Turnstile, upserts user,
     records referral SIGNUP events, and returns a short-lived email-verify JWT.
   ========================================================================== */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import "dotenv/config";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client.serverless.js";

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────
function getAllowedOrigins(): string[] {
  const raw = process.env.APP_URL ?? "*";
  return raw === "*" ? ["*"] : raw.split(",").map((s) => s.trim()).filter(Boolean);
}
function setCors(req: VercelRequest, res: VercelResponse) {
  const origins = getAllowedOrigins();
  const requestOrigin = (req.headers.origin as string) || "";
  const allow =
    origins.includes("*") || origins.includes(requestOrigin)
      ? requestOrigin || origins[0]
      : origins[0];
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", allow || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
}

// Env warnings (handy in dev)
(["DATABASE_URL", "JWT_SECRET", "TURNSTILE_SECRET_KEY"] as const).forEach((k) => {
  if (!process.env[k]) console.warn(`[waitlist] missing env ${k}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────
const JoinSchema = z.object({
  email: z.string().email(),
  role: z.string().min(1).max(40),
  experience: z.enum(["New", "Intermediate", "Advanced"]).optional(),
  discord: z.string().max(80).optional(),
  github: z.string().max(120).optional(),
  country: z.string().max(80).optional(),
  referral: z.string().max(64).optional(),
  referral_auto: z.string().max(64).optional(),
  utm_source: z.string().max(64).optional(),
  utm_medium: z.string().max(64).optional(),
  utm_campaign: z.string().max(64).optional(),
  utm_content: z.string().max(64).optional(),
  utm_term: z.string().max(64).optional(),
  // Cloudflare Turnstile token (any of these fields)
  turnstileToken: z.string().min(5).optional(),
  ["cf-turnstile-response"]: z.string().min(5).optional(),
  cf_turnstile_response: z.string().min(5).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Turnstile verify (with dev bypass)
// ─────────────────────────────────────────────────────────────────────────────
async function verifyTurnstile(token: string, ip?: string) {
  if (process.env.NODE_ENV !== "production" && token === "TEST_BYPASS") return true;
  const secret = process.env.TURNSTILE_SECRET_KEY || "";
  if (!secret) return false;

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);

  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  if (!r.ok) return false;
  const data = await r.json().catch(() => ({} as any));
  return !!(data as any)?.success;
}

// Helpers
function makeReferralCode(email: string) {
  const seed = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${seed}${rand}`;
}
function getRows(execResult: any) {
  return Array.isArray(execResult) ? execResult : execResult?.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // Safe body parse (prevents JSON parse errors on empty/invalid bodies)
    let raw: any = {};
    if (typeof req.body === "string") {
      const t = req.body.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try { raw = JSON.parse(t); } catch { raw = {}; }
      }
    } else if (req.body && typeof req.body === "object") {
      raw = req.body;
    }

    const parsed = JoinSchema.safeParse({
      ...raw,
      turnstileToken:
        raw["cf-turnstile-response"] ||
        raw["cf_turnstile_response"] ||
        raw["turnstileToken"] ||
        raw["token"],
    });
    if (!parsed.success) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid payload", details: parsed.error.flatten() });
    }

    const data = parsed.data;
    const token =
      data["cf-turnstile-response"] || data["cf_turnstile_response"] || data.turnstileToken || "";
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      (req.headers["x-real-ip"] as string) ||
      undefined;

    const human = await verifyTurnstile(token, ip);
    if (!human) return res.status(401).json({ ok: false, error: "Human verification failed" });

    const db = await getDb();

    const email = data.email.toLowerCase().trim();
    const refCodeIn = data.referral?.trim() || data.referral_auto?.trim() || null;

    // Build UTM JSON and strip nulls
    const utmPayload = {
      source: data.utm_source ?? null,
      medium: data.utm_medium ?? null,
      campaign: data.utm_campaign ?? null,
      content: data.utm_content ?? null,
      term: data.utm_term ?? null,
    };
    const utmJson = sql`jsonb_strip_nulls(${JSON.stringify(utmPayload)}::jsonb)`;

    // 1) Look up existing user by case-insensitive email
    const existingQ = sql<{ id: string; email: string; referral_code: string | null }>`
      SELECT id, email, referral_code
        FROM user_account
       WHERE lower(email) = ${email}
       LIMIT 1
    `;
    const existingRows = getRows(await db.execute(existingQ));
    const existing = existingRows?.[0] || null;

    // We'll populate this and return it
    let user: { id: string; email: string; referral_code: string };

    if (existing) {
      // 2a) UPDATE path — merge fields, merge UTM (existing || new)
      const updateQ = sql<{ id: string; email: string; referral_code: string | null }>`
        UPDATE user_account
           SET role = ${data.role},
               experience = ${data.experience ?? null},
               discord = ${data.discord ?? null},
               github = ${data.github ?? null},
               country = ${data.country ?? null},
               utm = jsonb_strip_nulls(user_account.utm || ${utmJson})
         WHERE id = ${existing.id}
     RETURNING id, email, referral_code
      `;
      const updRows = getRows(await db.execute(updateQ));
      const current =
        updRows?.[0] ??
        { id: existing.id, email: existing.email, referral_code: existing.referral_code };

      // Ensure referral code exists
      let rc = current.referral_code ?? "";
      if (!rc) {
        for (let i = 0; i < 3 && !rc; i++) {
          const candidate = makeReferralCode(email);
          try {
            const setCode = sql<{ referral_code: string }>`
              UPDATE user_account
                 SET referral_code = ${candidate}
               WHERE id = ${current.id}
           RETURNING referral_code
            `;
            const setRows = getRows(await db.execute(setCode));
            rc = setRows?.[0]?.referral_code || "";
          } catch (e: any) {
            const msg = String(e?.message || e);
            if (/\bunique\b/i.test(msg) && /\breferral_code\b/i.test(msg)) continue;
            throw e;
          }
        }
      }

      user = { id: current.id, email: current.email, referral_code: rc || makeReferralCode(email) };
    } else {
      // 2b) INSERT path — retry referral_code on collision
      let inserted: { id: string; email: string; referral_code: string } | null = null;
      for (let i = 0; i < 3 && !inserted; i++) {
        const candidateCode = makeReferralCode(email);
        const insertQ = sql<{ id: string; email: string; referral_code: string }>`
          INSERT INTO user_account (
            email, role, experience, discord, github, country, referral_code, utm
          )
          VALUES (
            ${email}, ${data.role}, ${data.experience ?? null}, ${data.discord ?? null},
            ${data.github ?? null}, ${data.country ?? null}, ${candidateCode}, ${utmJson}
          )
          RETURNING id, email, referral_code
        `;
        try {
          const insRows = getRows(await db.execute(insertQ));
          inserted = insRows?.[0] || null;
        } catch (e: any) {
          const msg = String(e?.message || e);
          if (/\bunique\b/i.test(msg) && /\breferral_code\b/i.test(msg)) continue; // regenerate and retry
          throw e;
        }
      }
      if (!inserted) throw new Error("Failed to insert user");
      user = inserted;
    }

    // 3) Log referral SIGNUP if present (not self)
    if (refCodeIn) {
      const logReferral = sql`
        INSERT INTO referral_event (referrer_id, referee_id, kind)
        SELECT u1.id, u2.id, 'SIGNUP'
          FROM user_account u1
          JOIN user_account u2 ON lower(u2.email) = ${email}
         WHERE u1.referral_code = ${refCodeIn}
           AND u1.id <> u2.id
        ON CONFLICT DO NOTHING
      `;
      await db.execute(logReferral);
    }

    // 4) Short-lived JWT for email verification (HS256)
    const verifyToken = jwt.sign(
      { sub: user.id, email: user.email, typ: "email-verify" },
      process.env.JWT_SECRET as string,
      { expiresIn: "2d", algorithm: "HS256", issuer: "quantara", audience: "user" }
    );

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      code: user.referral_code,
      user: { email: user.email, referral_code: user.referral_code },
      verifyToken,
    });
  } catch (err) {
    console.error("[waitlist] error:", err);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
}
