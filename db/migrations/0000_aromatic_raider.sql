CREATE TABLE "faucet_claim" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigserial,
	"ss58_address" text NOT NULL,
	"ip_hash" text NOT NULL,
	"amount_qtr" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"referrer_id" bigserial NOT NULL,
	"referee_id" bigserial NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_account" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"experience" text,
	"discord" text,
	"github" text,
	"country" text,
	"referral_code" text,
	"referred_by" bigserial,
	"email_verified" boolean DEFAULT false NOT NULL,
	"turnstile_ok" boolean DEFAULT false NOT NULL,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "faucet_claim_user_idx" ON "faucet_claim" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "faucet_claim_addr_idx" ON "faucet_claim" USING btree ("ss58_address");--> statement-breakpoint
CREATE INDEX "faucet_claim_status_idx" ON "faucet_claim" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ref_event_referrer_idx" ON "referral_event" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "ref_event_referee_idx" ON "referral_event" USING btree ("referee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_account_email_uq" ON "user_account" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_account_referral_code_uq" ON "user_account" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "user_account_referred_by_idx" ON "user_account" USING btree ("referred_by");