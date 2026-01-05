-- Backfill Domain Tiers for Existing Fetch Profiles
-- Run this BEFORE enabling TIER_POLICY_ENABLED=true in production
--
-- Strategy:
-- 1. Paid-first profiles (preferredProvider set or stopAfterPreferredFailure) → tier_b
-- 2. Known hostile domains (Etsy, Amazon, Temu, etc.) → tier_c
-- 3. Everything else stays tier_a (default)
--
-- IMPORTANT: Run in transaction, verify counts before commit

BEGIN;

-- Step 1: Verify current state
SELECT 'BEFORE backfill:' as status;
SELECT domain_tier, COUNT(*) as count
FROM fetch_profiles
GROUP BY domain_tier
ORDER BY count DESC;

-- Step 2: Paid-first profiles → tier_b
-- These have explicit paid provider configuration
UPDATE fetch_profiles
SET domain_tier = 'tier_b'
WHERE domain_tier = 'tier_a'  -- Only upgrade from tier_a
  AND (
    preferred_provider IS NOT NULL
    OR stop_after_preferred_failure = true
  );

SELECT 'Upgraded to tier_b:' as status, COUNT(*) as count
FROM fetch_profiles WHERE domain_tier = 'tier_b';

-- Step 3: Known hostile domains → tier_c
-- These require best-effort approach with multiple paid fallbacks
-- Join with sources to get domain from URL
UPDATE fetch_profiles fp
SET domain_tier = 'tier_c'
FROM sources s
WHERE s.fetch_profile_id = fp.id
  AND fp.domain_tier IN ('tier_a', 'tier_b')  -- Upgrade from either
  AND (
    -- DataDome-protected sites
    s.url ILIKE '%temu.com%'
    OR s.url ILIKE '%shein.com%'
    -- Heavy anti-bot (not always blocked, but unreliable)
    -- Note: Amazon/Etsy should be tier_b with brightdata, not tier_c
    -- Only upgrade to tier_c if they're consistently failing
  );

SELECT 'Upgraded to tier_c:' as status, COUNT(*) as count
FROM fetch_profiles WHERE domain_tier = 'tier_c';

-- Step 4: Final state
SELECT 'AFTER backfill:' as status;
SELECT domain_tier, COUNT(*) as count
FROM fetch_profiles
GROUP BY domain_tier
ORDER BY count DESC;

-- Step 5: Show profiles by tier with sample domains
SELECT 'tier_b profiles (paid-first):' as status;
SELECT fp.id, fp.name, fp.preferred_provider, fp.domain_tier,
       (SELECT s.url FROM sources s WHERE s.fetch_profile_id = fp.id LIMIT 1) as sample_url
FROM fetch_profiles fp
WHERE fp.domain_tier = 'tier_b'
LIMIT 10;

SELECT 'tier_c profiles (hostile/best-effort):' as status;
SELECT fp.id, fp.name, fp.preferred_provider, fp.domain_tier,
       (SELECT s.url FROM sources s WHERE s.fetch_profile_id = fp.id LIMIT 1) as sample_url
FROM fetch_profiles fp
WHERE fp.domain_tier = 'tier_c'
LIMIT 10;

-- Verify no inconsistencies
SELECT 'CONFIG INCONSISTENCIES (should be empty):' as status;
SELECT fp.id, fp.name, fp.domain_tier, fp.preferred_provider, fp.stop_after_preferred_failure
FROM fetch_profiles fp
WHERE
  -- tier_a with paid config = inconsistent
  (fp.domain_tier = 'tier_a' AND (fp.preferred_provider IS NOT NULL OR fp.stop_after_preferred_failure = true))
  -- tier_b/c with no paid config but explicit tier = intentional, ok
;

-- COMMIT only after verifying the results above
-- ROLLBACK; -- Uncomment to abort
COMMIT;
