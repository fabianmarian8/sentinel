-- CreateEnum
CREATE TYPE "FetchOutcome" AS ENUM ('ok', 'blocked', 'captcha_required', 'empty', 'timeout', 'network_error', 'provider_error');

-- CreateEnum
CREATE TYPE "FetchProvider" AS ENUM ('http', 'mobile_ua', 'headless', 'flaresolverr', 'brightdata', 'scraping_browser', 'twocaptcha_proxy', 'twocaptcha_datadome');

-- CreateEnum
CREATE TYPE "BlockKind" AS ENUM ('cloudflare', 'datadome', 'perimeterx', 'captcha', 'rate_limit', 'unknown');

-- CreateTable
CREATE TABLE "fetch_attempts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "rule_id" TEXT,
    "url" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "provider" "FetchProvider" NOT NULL,
    "outcome" "FetchOutcome" NOT NULL,
    "block_kind" "BlockKind",
    "http_status" INTEGER,
    "final_url" TEXT,
    "body_bytes" INTEGER NOT NULL,
    "content_type" TEXT,
    "latency_ms" INTEGER,
    "signals_json" JSONB,
    "error_detail" TEXT,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cost_units" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fetch_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_stats" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ok_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_count" INTEGER NOT NULL DEFAULT 0,
    "empty_count" INTEGER NOT NULL DEFAULT 0,
    "timeout_count" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_latency_ms" INTEGER,
    "by_provider_json" JSONB,

    CONSTRAINT "domain_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fetch_attempts_workspace_id_hostname_created_at_idx" ON "fetch_attempts"("workspace_id", "hostname", "created_at");

-- CreateIndex
CREATE INDEX "fetch_attempts_workspace_id_provider_created_at_idx" ON "fetch_attempts"("workspace_id", "provider", "created_at");

-- CreateIndex
CREATE INDEX "fetch_attempts_rule_id_created_at_idx" ON "fetch_attempts"("rule_id", "created_at");

-- CreateIndex
CREATE INDEX "fetch_attempts_hostname_outcome_created_at_idx" ON "fetch_attempts"("hostname", "outcome", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "domain_stats_workspace_id_hostname_date_key" ON "domain_stats"("workspace_id", "hostname", "date");

-- CreateIndex
CREATE INDEX "domain_stats_workspace_id_date_idx" ON "domain_stats"("workspace_id", "date");
