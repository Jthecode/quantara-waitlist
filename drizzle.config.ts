// ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
// ┃ Quantara — Waitlist/Tooling — Phase-1 Ready                         ┃
// ┃ File: drizzle.config.ts                                             ┃
// ┃ Role: Drizzle Kit configuration (Neon Postgres migrations/schema)   ┃
// ┃ License: Quantara Open Source License v1 (Apache-2.0 compatible)    ┃
// ┃ SPDX-License-Identifier: Apache-2.0 OR QOSL-1.0                     ┃
// ┃ Copyright (C) 2025 Quantara Technology LLC. All rights reserved.    ┃
// ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

import 'dotenv/config';
import type { Config } from 'drizzle-kit';

// Basic safety: require a Postgres/Neon URL at build time.
const RAW_URL = (process.env.DATABASE_URL ?? '').trim();
if (!RAW_URL || !/^postgres(ql)?:\/\//i.test(RAW_URL)) {
  throw new Error(
    'Missing or invalid DATABASE_URL. Set a Neon Postgres connection string in .env / Vercel env.'
  );
}

const isProd = process.env.NODE_ENV === 'production';

export default {
  schema: './db/schema.ts',
  out: './db/migrations',          // keeps migrations alongside schema
  dialect: 'postgresql',
  dbCredentials: {
    url: RAW_URL,
  },

  // Drizzle Kit flags
  strict: true,                    // fail fast on unknown config/schema issues
  verbose: !isProd,                // quieter on CI/prod, chatty locally
} satisfies Config;
