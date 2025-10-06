/**
 * Quantara Devnet-0 • internal use only
 * (c) 2025 Quantara Technology LLC
 * This file is part of the Devnet-0 waitlist & faucet preview stack.
 * Purpose: Drizzle Kit configuration for migrations & schema generation.
 */

import 'dotenv/config';
import type { Config } from 'drizzle-kit';

if (!process.env.DATABASE_URL || !/^postgres/i.test(process.env.DATABASE_URL)) {
  throw new Error(
    'Missing or invalid DATABASE_URL. Add it to .env (Postgres/Neon connection string).'
  );
}

export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },

  // Helpful during development
  strict: true,
  verbose: true,

  // Optional but nice: keep generated names snake_case if you introspect later
  // introspect: { casing: 'snake_case' },
} satisfies Config;
