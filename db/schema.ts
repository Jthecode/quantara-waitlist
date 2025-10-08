/* ============================================================================
   Quantara • Devnet-0 • Database Schema (Drizzle ORM)
   (c) 2025 Quantara Technology LLC
   File: db/schema.ts
   Purpose:
     - user_account, referral_event, faucet_claim
     - JSONB UTM, email/turnstile flags, referral indices
     - FK constraints + case-insensitive email unique index
   ========================================================================== */

import {
  pgTable,
  bigserial,
  bigint as pgBigint, // avoid TS primitive name clash
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ────────────────────────────────────────────────────────────────────────────
   Enums
   ────────────────────────────────────────────────────────────────────────── */
export const referralKind = pgEnum("referral_kind", ["CLICK", "SIGNUP", "VERIFIED"]);
export const faucetStatus = pgEnum("faucet_status", ["PENDING", "SENT", "REJECTED"]);

/* ────────────────────────────────────────────────────────────────────────────
   USERS
   ────────────────────────────────────────────────────────────────────────── */
export const userAccount = pgTable(
  "user_account",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),

    // Enforce uniqueness via LOWER(email) expression index (below)
    email: text("email").notNull(),

    role: text("role"),               // 'Enthusiast' | 'Creator' | 'Builder' | ...
    experience: text("experience"),   // 'New' | 'Intermediate' | 'Advanced'
    discord: text("discord"),
    github: text("github"),
    country: text("country"),

    // Stable referral code (nullable until generated).
    referralCode: text("referral_code"),

    // Self-referencing FK (nullable)
    referredBy: pgBigint("referred_by", { mode: "bigint" }),

    emailVerified: boolean("email_verified").notNull().default(false),
    turnstileOk: boolean("turnstile_ok").notNull().default(false),

    // All UTM fields in one JSONB blob
    utm: jsonb("utm")
      .$type<{ source?: string; medium?: string; campaign?: string; content?: string; term?: string }>()
      .notNull()
      .default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Case-insensitive UNIQUE on email
    emailLowerUq: uniqueIndex("user_account_email_lower_uq").on(sql`lower(${t.email})`),

    // Helpful non-unique index for lookups
    emailLowerIdx: index("user_account_email_lower_idx").on(sql`lower(${t.email})`),

    referralCodeUq: uniqueIndex("user_account_referral_code_uq").on(t.referralCode),

    referredByIdx: index("user_account_referred_by_idx").on(t.referredBy),

    // Self-referencing FK
    referredByFk: foreignKey({
      columns: [t.referredBy],
      foreignColumns: [t.id],
      name: "user_account_referred_by_fk",
    })
      .onUpdate("cascade")
      .onDelete("set null"),
  })
);

/* ────────────────────────────────────────────────────────────────────────────
   REFERRALS: Track referral lifecycle events (CLICK | SIGNUP | VERIFIED)
   ────────────────────────────────────────────────────────────────────────── */
export const referralEvent = pgTable(
  "referral_event",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),

    referrerId: pgBigint("referrer_id", { mode: "bigint" })
      .notNull()
      .references(() => userAccount.id, { onDelete: "cascade", onUpdate: "cascade" }),

    refereeId: pgBigint("referee_id", { mode: "bigint" })
      .notNull()
      .references(() => userAccount.id, { onDelete: "cascade", onUpdate: "cascade" }),

    kind: referralKind("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byReferrerIdx: index("ref_event_referrer_idx").on(t.referrerId),
    byRefereeIdx: index("ref_event_referee_idx").on(t.refereeId),
    byKindIdx: index("ref_event_kind_idx").on(t.kind),

    // Prevent duplicates like (referrer, referee, kind) twice
    uniqueTriplet: uniqueIndex("ref_event_referrer_referee_kind_uq").on(
      t.referrerId,
      t.refereeId,
      t.kind
    ),
  })
);

/* ────────────────────────────────────────────────────────────────────────────
   FAUCET CLAIMS
   ────────────────────────────────────────────────────────────────────────── */
export const faucetClaim = pgTable(
  "faucet_claim",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),

    userId: pgBigint("user_id", { mode: "bigint" }).references(() => userAccount.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),

    ss58Address: text("ss58_address").notNull(),

    // Store salted hash, NOT raw IP (hash in app layer)
    ipHash: text("ip_hash").notNull(),

    // QTR uses 12 decimals → store as text for exactness ("100.000000000000")
    amountQtr: text("amount_qtr").notNull(),

    status: faucetStatus("status").notNull().default("PENDING"),
    reason: text("reason"),
    txHash: text("tx_hash"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUserIdx: index("faucet_claim_user_idx").on(t.userId),
    byAddrIdx: index("faucet_claim_addr_idx").on(t.ss58Address),
    byStatusIdx: index("faucet_claim_status_idx").on(t.status),
    byTxIdx: index("faucet_claim_tx_idx").on(t.txHash),
  })
);

/* ────────────────────────────────────────────────────────────────────────────
   Helpful type exports
   ────────────────────────────────────────────────────────────────────────── */
export type UserAccount = typeof userAccount.$inferSelect;
export type NewUserAccount = typeof userAccount.$inferInsert;

export type ReferralEvent = typeof referralEvent.$inferSelect;
export type NewReferralEvent = typeof referralEvent.$inferInsert;

export type FaucetClaim = typeof faucetClaim.$inferSelect;
export type NewFaucetClaim = typeof faucetClaim.$inferInsert;

/* Optional: export a tables-only object if you want to import a clean schema
   object instead of the whole module. Either approach works with Drizzle. */
export const tables = {
  userAccount,
  referralEvent,
  faucetClaim,
};
