-- Add brightdata to FetchMode enum
-- This fixes the reporting bug where brightdata was incorrectly mapped to 'http'

ALTER TYPE "FetchMode" ADD VALUE 'brightdata';

-- Add not_found to FetchOutcome enum
-- HTTP 404 is NOT a provider failure - it means the product/page doesn't exist

ALTER TYPE "FetchOutcome" ADD VALUE 'not_found';
