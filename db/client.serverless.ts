/* Quantara © 2025 — Devnet-0 waitlist API
 * db/client.serverless.ts — Neon (serverless) client
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/neon-http'; // correct adapter for @neondatabase/serverless
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

// Fetch-based client (no connect/close lifecycle in serverless)
const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql);

export async function getDb() {
  return db;
}
