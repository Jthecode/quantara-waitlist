/* ============================================================================
   Quantara • Devnet-0 • Database Schema (Drizzle ORM)
   (c) 2025 Quantara Technology LLC
   File: db/schema.ts
   Purpose:
     - Defines tables for: user_account, referral_event, faucet_claim
     - JSONB UTM object, email/turnstile flags, referral indices
   ========================================================================== */

import {
  pgTable,
  bigserial,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────────────────────
export const userAccount = pgTable(
  'user_account',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    email: text('email').notNull(),
    role: text('role'),               // 'Enthusiast' | 'Creator' | 'Builder' | ...
    experience: text('experience'),   // 'New' | 'Intermediate' | 'Advanced'
    discord: text('discord'),
    github: text('github'),
    country: text('country'),
    referralCode: text('referral_code'),
    referredBy: bigserial('referred_by', { mode: 'bigint' }),
    emailVerified: boolean('email_verified').notNull().default(false),
    turnstileOk: boolean('turnstile_ok').notNull().default(false),
    // Store all UTM fields in one JSONB blob (e.g., { source, medium, campaign, content, term })
    utm: jsonb('utm').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('user_account_email_uq').on(t.email),
    referralCodeIdx: uniqueIndex('user_account_referral_code_uq').on(t.referralCode),
    referredByIdx: index('user_account_referred_by_idx').on(t.referredBy),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
/** REFERRALS: Track referral lifecycle events.
 *  kind: 'CLICK' | 'SIGNUP' | 'VERIFIED' (you can expand later)
 */
// ─────────────────────────────────────────────────────────────────────────────
export const referralEvent = pgTable(
  'referral_event',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    referrerId: bigserial('referrer_id', { mode: 'bigint' }).notNull(),
    refereeId: bigserial('referee_id', { mode: 'bigint' }).notNull(),
    kind: text('kind').notNull(), // 'CLICK' | 'SIGNUP' | 'VERIFIED'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byReferrerIdx: index('ref_event_referrer_idx').on(t.referrerId),
    byRefereeIdx: index('ref_event_referee_idx').on(t.refereeId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// FAUCET CLAIMS
// ─────────────────────────────────────────────────────────────────────────────
export const faucetClaim = pgTable(
  'faucet_claim',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    userId: bigserial('user_id', { mode: 'bigint' }),
    ss58Address: text('ss58_address').notNull(),
    ipHash: text('ip_hash').notNull(), // salted hash; do not store raw IP
    amountQtr: text('amount_qtr').notNull(), // store as text for 12-decimal token
    status: text('status').notNull(), // 'PENDING' | 'SENT' | 'REJECTED'
    reason: text('reason'),
    txHash: text('tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUserIdx: index('faucet_claim_user_idx').on(t.userId),
    byAddrIdx: index('faucet_claim_addr_idx').on(t.ss58Address),
    byStatusIdx: index('faucet_claim_status_idx').on(t.status),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpful type exports (use in API routes/services)
// ─────────────────────────────────────────────────────────────────────────────
export type UserAccount = typeof userAccount.$inferSelect;
export type NewUserAccount = typeof userAccount.$inferInsert;

export type ReferralEvent = typeof referralEvent.$inferSelect;
export type NewReferralEvent = typeof referralEvent.$inferInsert;

export type FaucetClaim = typeof faucetClaim.$inferSelect;
export type NewFaucetClaim = typeof faucetClaim.$inferInsert;
