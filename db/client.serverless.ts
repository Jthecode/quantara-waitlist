/* ============================================================================
   Quantara © 2025 — Devnet-0 waitlist API
   db/client.serverless.ts — Neon (serverless) client wired to Drizzle
   ========================================================================== */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema.js"; // NodeNext requires .js suffix for TS files

// ---- Env guard --------------------------------------------------------------
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

// ---- Neon fetch client (no pooling in serverless) ---------------------------
const neonSql = neon(DATABASE_URL);

// ---- Keep a singleton across hot reloads ------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __Q_DB__: NeonHttpDatabase<typeof schema> | undefined;
}

let _db: NeonHttpDatabase<typeof schema> | undefined = globalThis.__Q_DB__;

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!_db) {
    _db = drizzle(neonSql, { schema });
    globalThis.__Q_DB__ = _db;
  }
  return _db;
}

// ---- Quick health check for /api/health ------------------------------------
export async function ping(): Promise<boolean> {
  try {
    await neonSql`select 1`; // template-tag query supported by @neondatabase/serverless
    return true;
  } catch {
    return false;
  }
}

// Re-export schema/types for convenience
export { schema };
export type DB = ReturnType<typeof getDb>;
