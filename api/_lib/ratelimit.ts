import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! })
  : undefined;

export const rlPerHour = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(+(process.env.FAUCET_CLAIMS_PER_HOUR ?? 1), "1 h") })
  : undefined;

export async function limit(key: string) {
  if (!rlPerHour) return { success: true };
  return rlPerHour.limit(key);
}
