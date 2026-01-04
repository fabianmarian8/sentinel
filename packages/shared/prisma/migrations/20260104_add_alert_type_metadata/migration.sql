-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('value_changed', 'schema_drift', 'market_context', 'budget_exceeded', 'provider_error', 'extraction_error', 'threshold_alert');

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN "alert_type" "AlertType";
ALTER TABLE "alerts" ADD COLUMN "metadata" JSONB;

-- CreateIndex
CREATE INDEX "alerts_alert_type_idx" ON "alerts"("alert_type");
