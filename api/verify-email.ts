/**
 * Quantara Devnet-0 • internal use only
 * (c) 2025 Quantara Technology LLC
 * File: api/verify-email.ts
 *
 * Confirms a user's email via JWT token, logs a `VERIFIED` referral_event,
 * and redirects (302) to /success.html?ref=<code> (or ?next=<path>).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import "dotenv/config";
import jwt from "jsonwebtoken";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client.serverless.js";

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function getRows(execResult: any) {
  return Array.isArray(execResult) ? execResult : execResult?.rows;
}

function buildRedirectUrl(req: VercelRequest, pathOrUrl: string) {
  const base =
    process.env.APP_URL ||
    (req.headers["x-forwarded-proto"] && req.headers["x-forwarded-host"]
      ? `${req.headers["x-forwarded-proto"]}://${req.headers["x-forwarded-host"]}`
      : `https://${req.headers.host}`);
  try {
    return new URL(pathOrUrl, base);
  } catch {
    return new URL("/success.html", base);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // tolerate raw+json bodies
    let body: any = {};
    if (typeof req.body === "string") {
      const t = req.body.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try {
          body = JSON.parse(t);
        } catch {
          body = {};
        }
      }
    } else if (req.body && typeof req.body === "object") {
      body = req.body;
    }

    const token =
      (req.query.token as string) ||
      (typeof body === "object" && (body as any)?.token) ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice("Bearer ".length)
        : undefined);

    const next = (req.query.next as string) || "/success.html";
    const wantsJson = (req.query.mode as string) === "json";

    if (!token) {
      const err = { ok: false, error: "Missing token" };
      return res.status(400).json(err);
    }
    if (!process.env.JWT_SECRET) {
      const err = { ok: false, error: "Server misconfig: JWT_SECRET" };
      return res.status(500).json(err);
    }

    // Verify token (must match how you signed it in /api/waitlist.ts)
    let payload: any;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: "quantara",
        audience: "user",
      });
    } catch {
      const err = { ok: false, error: "Invalid or expired token" };
      return res.status(401).json(err);
    }

    const userId = payload?.sub as string | undefined;
    if (!userId) {
      const err = { ok: false, error: "Invalid token payload" };
      return res.status(400).json(err);
    }

    const db = await getDb();

    // Fetch user + referral_code
    const userQ = sql<{ id: string; email: string; referral_code: string | null; email_verified: boolean }>`
      SELECT id, email, referral_code, email_verified
      FROM user_account
      WHERE id = ${userId}
      LIMIT 1
    `;
    const userRows = getRows(await db.execute(userQ));
    const user = userRows?.[0];
    if (!user) {
      const err = { ok: false, error: "User not found" };
      return res.status(404).json(err);
    }

    // Mark email as verified (idempotent)
    if (!user.email_verified) {
      const upd = sql`UPDATE user_account SET email_verified = true WHERE id = ${user.id}`;
      await db.execute(upd);
    }

    // Award VERIFIED once if the user had a prior SIGNUP referral
    // (JOINED no longer exists in the enum)
    const refQ = sql<{ referrer_id: string }>`
      SELECT referrer_id
      FROM referral_event
      WHERE referee_id = ${user.id}
        AND kind = 'SIGNUP'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const refRows = getRows(await db.execute(refQ));
    const ref = refRows?.[0];

    if (ref?.referrer_id) {
      const ins = sql`
        INSERT INTO referral_event (referrer_id, referee_id, kind)
        VALUES (${ref.referrer_id}, ${user.id}, 'VERIFIED')
        ON CONFLICT DO NOTHING
      `;
      await db.execute(ins);
    }

    // Build redirect
    const dest = buildRedirectUrl(req, next);
    if (user.referral_code) dest.searchParams.set("ref", user.referral_code);

    res.setHeader("Cache-Control", "no-store");

    if (wantsJson) {
      return res.status(200).json({
        ok: true,
        verified: true,
        awarded: Boolean(ref?.referrer_id) || false,
        redirect: dest.toString(),
      });
    }

    // 302 redirect
    res.status(302).setHeader("Location", dest.toString()).send("");
  } catch (err) {
    console.error("[verify-email] error:", err);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
}
