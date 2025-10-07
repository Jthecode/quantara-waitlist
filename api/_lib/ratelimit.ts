// api/_lib/ratelimit.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/** Optional Redis client (only if both envs are set) */
export const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      })
    : undefined;

/** Sliding window: FAUCET_CLAIMS_PER_HOUR per hour (default 1/hr) */
export const rlPerHour = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        +(process.env.FAUCET_CLAIMS_PER_HOUR ?? 1),
        "1 h"
      ),
    })
  : undefined;

/**
 * Call in your API route to rate-limit a given key (ip/email/etc).
 * Returns { success, limit, remaining, reset }.
 */
export async function limit(key: string) {
  if (!rlPerHour) return { success: true, limit: 0, remaining: 0, reset: 0 }; // no-op if not configured
  return rlPerHour.limit(key);
}

/**
 * Helper to build a 429 response with standard headers.
 * Works for fetch-style handlers (Vercel Edge / Web API).
 */
export function tooManyResponse(resetSeconds?: number, message = "Too many requests") {
  const h = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  if (typeof resetSeconds === "number" && resetSeconds > 0) {
    h.set("Retry-After", String(resetSeconds));
  }
  return new Response(JSON.stringify({ ok: false, error: "rate_limited", message }), {
    status: 429,
    headers: h,
  });
}

/**
 * Utility to derive a stable key from request context.
 * You can pass an explicit key (email), or fall back to IP.
 */
export function keyFrom(req: Request, explicit?: string) {
  if (explicit) return explicit;
  const xf = req.headers.get("x-forwarded-for");
  const ip = xf?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return `ip:${ip}`;
}
