/**
 * Etsy Rules Seed Script
 *
 * Creates production-ready Etsy monitoring configuration:
 * - FetchProfile with BrightData paid-first (DataDome bypass)
 * - Price rule with schema.org extraction (low-first)
 * - Availability rule with schema.org extraction
 *
 * Run: npx tsx packages/shared/prisma/seed-etsy.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Configuration - update these for your workspace
const CONFIG = {
  // Replace with your actual workspace ID
  workspaceId: process.env.ETSY_WORKSPACE_ID || '11111111-1111-4111-8111-111111111111',
  // Etsy product URL to monitor
  productUrl: process.env.ETSY_PRODUCT_URL || 'https://www.etsy.com/listing/1234567890/sample-product',
};

// Fixed UUIDs for idempotent runs
const ETSY_FETCH_PROFILE_ID = 'etsy-prof-4444-8444-brightdata001';
const ETSY_SOURCE_ID = 'etsy-src0-4444-8444-source000001';
const ETSY_PRICE_RULE_ID = 'etsy-rule-4444-8444-price0000001';
const ETSY_AVAIL_RULE_ID = 'etsy-rule-4444-8444-avail0000001';

async function main() {
  console.log('🛒 Seeding Etsy monitoring rules...\n');

  // Verify workspace exists
  const workspace = await prisma.workspace.findUnique({
    where: { id: CONFIG.workspaceId },
  });

  if (!workspace) {
    console.error(`❌ Workspace not found: ${CONFIG.workspaceId}`);
    console.error('Set ETSY_WORKSPACE_ID env variable to your workspace ID');
    process.exit(1);
  }
  console.log('✅ Found workspace:', workspace.name);

  // Delete existing Etsy data if exists (for idempotent re-runs)
  await prisma.rule.deleteMany({
    where: { id: { in: [ETSY_PRICE_RULE_ID, ETSY_AVAIL_RULE_ID] } },
  }).catch(() => {});
  await prisma.source.deleteMany({
    where: { id: ETSY_SOURCE_ID },
  }).catch(() => {});
  await prisma.fetchProfile.deleteMany({
    where: { id: ETSY_FETCH_PROFILE_ID },
  }).catch(() => {});

  // Create BrightData fetch profile for Etsy (DataDome bypass)
  const fetchProfile = await prisma.fetchProfile.create({
    data: {
      id: ETSY_FETCH_PROFILE_ID,
      workspaceId: CONFIG.workspaceId,
      name: 'Etsy BrightData (DataDome)',
      mode: 'headless', // Base mode, but preferredProvider overrides
      preferredProvider: 'brightdata', // Paid-first routing
      renderWaitMs: 2000,
    },
  });
  console.log('✅ Created fetch profile:', fetchProfile.name);

  // Extract domain from URL
  const url = new URL(CONFIG.productUrl);
  const domain = url.hostname;

  // Create Etsy source
  const source = await prisma.source.create({
    data: {
      id: ETSY_SOURCE_ID,
      workspaceId: CONFIG.workspaceId,
      url: CONFIG.productUrl,
      domain,
      fetchProfileId: fetchProfile.id,
    },
  });
  console.log('✅ Created source:', source.url);

  // Create Price rule with schema extraction (low-first strategy)
  const priceRule = await prisma.rule.create({
    data: {
      id: ETSY_PRICE_RULE_ID,
      name: 'Etsy Price Monitor (Schema)',
      ruleType: 'price',
      sourceId: source.id,
      enabled: true,
      extraction: {
        method: 'schema',
        selector: JSON.stringify({ kind: 'price', prefer: 'low' }),
        attribute: null,
      },
      normalization: {
        type: 'price',
        locale: 'en-US',
      },
      schedule: {
        intervalSeconds: 3600, // 1 hour
        jitterSeconds: 300, // 5 min jitter
      },
      alertPolicy: {
        channels: ['email'],
        conditions: [
          { type: 'value_changed', severity: 'medium' },
          { type: 'format_changed', severity: 'high' }, // Currency change
        ],
      },
      healthScore: 100,
      nextRunAt: new Date(),
    },
  });
  console.log('✅ Created price rule:', priceRule.name);

  // Create Availability rule with schema extraction
  const availRule = await prisma.rule.create({
    data: {
      id: ETSY_AVAIL_RULE_ID,
      name: 'Etsy Availability Monitor (Schema)',
      ruleType: 'availability',
      sourceId: source.id,
      enabled: true,
      extraction: {
        method: 'schema',
        selector: JSON.stringify({ kind: 'availability' }),
        attribute: null,
      },
      normalization: null,
      schedule: {
        intervalSeconds: 1800, // 30 min - availability changes faster
        jitterSeconds: 180, // 3 min jitter
      },
      alertPolicy: {
        channels: ['email'],
        conditions: [
          { type: 'value_changed', severity: 'high' }, // Stock change is important
        ],
      },
      healthScore: 100,
      nextRunAt: new Date(),
    },
  });
  console.log('✅ Created availability rule:', availRule.name);

  console.log('\n🎉 Etsy monitoring setup complete!\n');
  console.log('Configuration:');
  console.log('  Fetch Profile:', fetchProfile.name, '(preferredProvider: brightdata)');
  console.log('  Source:', source.url);
  console.log('  Price Rule: schema extraction with low-first strategy');
  console.log('  Availability Rule: schema extraction for InStock/OutOfStock');
  console.log('\nRules will start processing on next scheduler cycle.');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
