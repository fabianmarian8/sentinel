-- Add geo_country to fetch_profiles for per-profile geo pinning
-- Replaces BRIGHTDATA_COUNTRY env var for multi-market support
ALTER TABLE "fetch_profiles" ADD COLUMN "geo_country" VARCHAR(2);
