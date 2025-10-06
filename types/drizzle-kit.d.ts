/**
 * Quantara Devnet-0 • internal use only
 * (c) 2025 Quantara Technology LLC
 * Purpose: Minimal ambient types so TS can resolve `drizzle-kit` in config.
 */

declare module 'drizzle-kit' {
  export interface Config {
    schema: string | string[];
    out: string;
    dialect: 'postgresql' | 'mysql' | 'sqlite';
    dbCredentials?: {
      url?: string;
      connectionString?: string;
      host?: string;
      user?: string;
      password?: string;
      database?: string;
      ssl?: boolean;
    };
    strict?: boolean;
    verbose?: boolean;
    casing?: 'camelCase' | 'snake_case';
    // (keep this minimal; expand only if you need more fields)
  }
}
