-- AlterTable
-- Add acknowledgement fields to alerts table
ALTER TABLE "alerts" ADD COLUMN "acknowledged_at" TIMESTAMP(3),
ADD COLUMN "acknowledged_by" TEXT;

-- CreateIndex
-- Optional: Add index for acknowledged alerts for faster queries
CREATE INDEX "alerts_acknowledged_at_idx" ON "alerts"("acknowledged_at");
