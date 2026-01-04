-- AlterTable
ALTER TABLE "rules" ADD COLUMN IF NOT EXISTS "schema_fingerprint" JSONB;
