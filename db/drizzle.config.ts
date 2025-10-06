import 'dotenv/config';
import type { Config } from 'drizzle-kit';

export default {
  schema: './db/schema.ts',
  out: './db/migrations',      // drizzle-kit will write SQL files here
  dialect: 'postgresql',       // (newer drizzle-kit uses 'dialect' not 'driver')
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // optional niceties:
  strict: true,
  verbose: true,
} satisfies Config;
