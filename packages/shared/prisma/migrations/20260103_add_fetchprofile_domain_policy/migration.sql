-- Add domain policy fields to FetchProfile
-- PR4: Provider allowlist/denylist and early exit control

-- Add disabled_providers array (providers that won't be tried for this profile)
-- Using FetchProvider enum array with NOT NULL and empty array default
ALTER TABLE "fetch_profiles" ADD COLUMN "disabled_providers" "FetchProvider"[] NOT NULL DEFAULT ARRAY[]::"FetchProvider"[];

-- Add stop_after_preferred_failure flag (don't try other providers if preferred fails)
ALTER TABLE "fetch_profiles" ADD COLUMN "stop_after_preferred_failure" BOOLEAN NOT NULL DEFAULT false;
