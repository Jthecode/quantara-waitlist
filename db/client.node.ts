/* Quantara © 2025 — Devnet-0 waitlist API
 * db/client.node.ts — node-postgres client
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

declare global {
  // eslint-disable-next-line no-var
  var __POOL__: Pool | undefined;
}

let pool = globalThis.__POOL__;
if (!pool) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : undefined,
  });
  if (process.env.NODE_ENV !== 'production') globalThis.__POOL__ = pool;
}

const db = drizzle(pool);

export async function getDb() {
  return db;
}

// optional: graceful shutdown in node environments
process.on('beforeExit', async () => {
  try {
    await pool?.end();
  } catch {}
});
