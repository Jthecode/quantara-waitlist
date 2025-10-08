/* ============================================================================
   Quantara Devnet-0 • internal use only
   (c) 2025 Quantara Technology LLC
   File: api/waitlist.ts

   Accepts waitlist joins, verifies Cloudflare Turnstile, upserts user,
   records referral SIGNUP events, and returns a short-lived email-verify JWT.

   Response: { ok: true, data: { id, code, emailQueued }, meta?: { verifyToken } }
   ========================================================================== */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import "dotenv/config";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client.serverless.js"; // <-- NodeNext requires .js

/* ────────────────────────────────────────────────────────────────────────────
   CORS
   ────────────────────────────────────────────────────────────────────────── */
function getAllowedOrigins(): string[] {
  const raw =
    process.env.ALLOWED_ORIGINS ??
    process.env.APP_URL ??
    "http://127.0.0.1:3000";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function setCors(_req: VercelRequest, res: VercelResponse) {
  const origins = getAllowedOrigins();
  const allow = origins.includes("*") ? "*" : origins[0] || "*";
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, cf-turnstile-response"
  );
  res.setHeader("Access-Control-Max-Age", "600");
}

/* Soft env checks (helpful locally) */
(["DATABASE_URL", "JWT_SECRET", "TURNSTILE_SECRET", "TURNSTILE_SECRET_KEY"] as const).forEach(
  (k) => {
    if (!process.env[k]) console.warn(`[waitlist] missing env ${k}`);
  }
);

/* ────────────────────────────────────────────────────────────────────────────
   Validation
   ────────────────────────────────────────────────────────────────────────── */
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

  // Cloudflare Turnstile token (accept several field names)
  turnstileToken: z.string().min(3).optional(),
  ["cf-turnstile-response"]: z.string().min(3).optional(),
  cf_turnstile_response: z.string().min(3).optional(),
});

/* ────────────────────────────────────────────────────────────────────────────
   Turnstile verify (TEST_BYPASS in non-prod)
   ────────────────────────────────────────────────────────────────────────── */
async function verifyTurnstile(token: string, ip?: string) {
  if (process.env.NODE_ENV !== "production" && token === "TEST_BYPASS") return true;

  const secret =
    process.env.TURNSTILE_SECRET || process.env.TURNSTILE_SECRET_KEY || "";
  if (!secret || !token) return false;

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);

  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  if (!r.ok) return false;
  const data = await r.json().catch(() => ({} as any));
  return !!(data as any)?.success;
}

/* ────────────────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────────────── */
function makeReferralCode(email: string) {
  const seed = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${seed}${rand}`;
}
function getRows(execResult: any) {
  return Array.isArray(execResult) ? execResult : execResult?.rows;
}

/* ────────────────────────────────────────────────────────────────────────────
   Handler
   ────────────────────────────────────────────────────────────────────────── */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  try {
    // tolerate raw JSON strings and objects
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
        raw["cf-turnstile-response"] ??
        raw["cf_turnstile_response"] ??
        raw["turnstileToken"] ??
        raw["token"],
    });
    if (!parsed.success) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "Invalid payload",
        details: parsed.error.flatten(),
      });
    }

    const data = parsed.data;
    const token =
      (data as any)["cf-turnstile-response"] ||
      (data as any)["cf_turnstile_response"] ||
      (data as any).turnstileToken ||
      "";
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      (req.headers["x-real-ip"] as string) ||
      undefined;

    const human = await verifyTurnstile(token, ip);
    if (!human) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res
        .status(401)
        .json({ ok: false, code: "TURNSTILE_FAILED", message: "Human verification failed" });
    }

    const db = await getDb();

    const email = data.email.toLowerCase().trim();
    const refCodeIn = data.referral?.trim() || data.referral_auto?.trim() || null;

    // Build UTM JSON and strip nulls (server-side)
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

    // will populate and return
    let user: { id: string; email: string; referral_code: string };

    if (existing) {
      // 2a) UPDATE — merge fields and UTM
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
        ({ id: existing.id, email: existing.email, referral_code: existing.referral_code } as const);

      // ensure referral_code exists (retry on unique collision)
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
      // 2b) INSERT — generate referral_code (retry on unique collision)
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

    // 3) Log referral SIGNUP if present (and not self)
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

    // TODO: enqueue verification email here; for now we mark as not queued
    const emailQueued = false;

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json({
      ok: true,
      data: { id: user.id, code: user.referral_code, emailQueued },
      meta: { verifyToken },
    });
  } catch (err) {
    console.error("[waitlist] error:", err);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res
      .status(500)
      .json({ ok: false, code: "INTERNAL", message: "Internal error, please try again." });
  }
}
