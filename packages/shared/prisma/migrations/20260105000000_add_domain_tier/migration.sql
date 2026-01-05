-- Migration: add_domain_tier_and_tier_policy_overrides
-- Safe, idempotent migration for Domain Tier Policy Engine

-- Step 1: Create DomainTier enum (without rate_limit - it's a state, not policy)
DO $$ BEGIN
  CREATE TYPE "DomainTier" AS ENUM ('tier_a', 'tier_b', 'tier_c', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN
    -- Enum exists, check if rate_limit needs removal
    -- This requires recreating the enum type
    NULL;
END $$;

-- Step 2: Add domain_tier column to fetch_profiles
ALTER TABLE "fetch_profiles" ADD COLUMN IF NOT EXISTS "domain_tier" "DomainTier" NOT NULL DEFAULT 'tier_a';

-- Step 3: Add tier_policy_overrides JSONB column for explicit overrides
-- This enables tri-state pattern: tier default vs explicit override
ALTER TABLE "fetch_profiles" ADD COLUMN IF NOT EXISTS "tier_policy_overrides" JSONB;

COMMENT ON COLUMN "fetch_profiles"."tier_policy_overrides" IS
'Explicit overrides for tier policy. Fields present here take precedence over tier defaults. Structure: { disabledProviders?: FetchProvider[], stopAfterPreferredFailure?: boolean, preferredProvider?: FetchProvider, geoCountry?: string }';

-- Step 4: Add interstitial_geo to FetchOutcome enum (for Target store-chooser etc.)
-- This is NOT a provider failure, circuit breaker should ignore it
DO $$ BEGIN
  ALTER TYPE "FetchOutcome" ADD VALUE IF NOT EXISTS 'interstitial_geo';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Step 5: Migrate any existing rate_limit values to tier_c (if rate_limit existed)
-- This handles the case where rate_limit was used as a "hostile domain" marker
UPDATE "fetch_profiles"
SET domain_tier = 'tier_c'
WHERE domain_tier::text = 'rate_limit';

-- Step 6: Create index for tier queries (optional, for SLO breakdown)
CREATE INDEX IF NOT EXISTS "idx_fetch_profiles_domain_tier" ON "fetch_profiles" ("domain_tier");
