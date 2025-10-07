/* Quantara © 2025 — Devnet-0 waitlist API
 * db/client.serverless.ts — Neon (serverless) client
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/neon-http";          // fetch-based adapter
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema.js";                    // ✅ bind schema for typed queries

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

// Create a single Neon fetch client (no pool needed in serverless)
const sql = neon(process.env.DATABASE_URL);

// Keep a singleton Drizzle instance to avoid re-instantiation on hot reloads
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!_db) _db = drizzle(sql, { schema });
  return _db;
}

// Optional: quick health check for /api/health
export async function ping(): Promise<boolean> {
  try {
    // neon client supports template-tagged queries
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}

// Re-export schema types if you want to import from this module
export { schema };
export type DB = ReturnType<typeof getDb>;
