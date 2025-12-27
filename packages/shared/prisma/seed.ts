/**
 * Database Seed Script
 *
 * Creates test data for development:
 * - Test user (test@example.com / password123)
 * - Default workspace
 * - Sample source and rule
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Valid UUID v4 format for seed data (13th char = 4, 17th char = 8/9/a/b)
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const FETCH_PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const RULE_ID = '44444444-4444-4444-8444-444444444444';

async function main() {
  console.log('🌱 Seeding database...\n');

  // Delete old records if they exist (both old string IDs and UUID formats)
  const oldIds = ['sample-rule', RULE_ID, '44444444-4444-4444-4444-444444444444'];
  const oldSourceIds = ['sample-source', SOURCE_ID, '33333333-3333-3333-3333-333333333333'];
  const oldProfileIds = ['default-fetch-profile', FETCH_PROFILE_ID, '22222222-2222-2222-2222-222222222222'];
  const oldWorkspaceIds = ['default-workspace', WORKSPACE_ID, '11111111-1111-1111-1111-111111111111'];

  await prisma.rule.deleteMany({ where: { id: { in: oldIds } } }).catch(() => {});
  await prisma.source.deleteMany({ where: { id: { in: oldSourceIds } } }).catch(() => {});
  await prisma.fetchProfile.deleteMany({ where: { id: { in: oldProfileIds } } }).catch(() => {});
  await prisma.workspaceMember.deleteMany({ where: { workspace: { id: { in: oldWorkspaceIds } } } }).catch(() => {});
  await prisma.workspace.deleteMany({ where: { id: { in: oldWorkspaceIds } } }).catch(() => {});

  // Create test user
  const passwordHash = await bcrypt.hash('password123', 12);

  const user = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      passwordHash,
    },
  });
  console.log('✅ Created user:', user.email);

  // Create default workspace with UUID
  const workspace = await prisma.workspace.create({
    data: {
      id: WORKSPACE_ID,
      name: 'My Workspace',
      type: 'ecommerce',
      ownerId: user.id,
      members: {
        create: {
          userId: user.id,
          role: 'owner',
        },
      },
    },
  });
  console.log('✅ Created workspace:', workspace.name, '(', workspace.id, ')');

  // Create fetch profile with UUID
  const fetchProfile = await prisma.fetchProfile.create({
    data: {
      id: FETCH_PROFILE_ID,
      workspaceId: workspace.id,
      name: 'Default HTTP Profile',
      mode: 'http',
      renderWaitMs: 1000,
    },
  });
  console.log('✅ Created fetch profile:', fetchProfile.name);

  // Create sample source with UUID
  const source = await prisma.source.create({
    data: {
      id: SOURCE_ID,
      url: 'https://example.com/product',
      domain: 'example.com',
      workspaceId: workspace.id,
      fetchProfileId: fetchProfile.id,
    },
  });
  console.log('✅ Created source:', source.url);

  // Create sample rule with UUID
  const rule = await prisma.rule.create({
    data: {
      id: RULE_ID,
      name: 'Sample Price Monitor',
      ruleType: 'price',
      sourceId: source.id,
      enabled: true,
      extraction: {
        method: 'css',
        selector: '.price',
        attribute: 'text',
      },
      normalization: {
        type: 'price',
        locale: 'en-US',
      },
      schedule: {
        intervalSeconds: 3600,
        jitterSeconds: 60,
      },
      alertPolicy: {
        conditions: [{ type: 'value_changed', severity: 'medium' }],
      },
      healthScore: 100,
      nextRunAt: new Date(), // Start immediately
    },
  });
  console.log('✅ Created rule:', rule.name);

  console.log('\n🎉 Seeding complete!\n');
  console.log('Test credentials:');
  console.log('  Email: test@example.com');
  console.log('  Password: password123');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
