/**
 * Anti-flap usage examples
 *
 * This file demonstrates typical usage scenarios.
 * Not included in build - for documentation purposes only.
 */

import { processAntiFlap, RuleState } from './index';

// Example 1: Price monitoring
function priceMonitoringExample() {
  console.log('\n=== Price Monitoring Example ===\n');

  let state: RuleState | null = null;

  // Initial price observation
  const price1 = { value: 99.99, currency: 'USD' };
  const step1 = processAntiFlap(price1, state, 3);

  console.log('Step 1 - First observation:');
  console.log('  Value:', price1);
  console.log('  Confirmed change:', step1.result.confirmedChange); // false
  console.log('  New stable:', step1.result.newStable); // { value: 99.99, currency: 'USD' }

  // Update state
  state = {
    ruleId: 'price-monitor-1',
    lastStable: step1.newState.lastStable!,
    candidate: step1.newState.candidate!,
    candidateCount: step1.newState.candidateCount!,
    updatedAt: new Date(),
  };

  // Price drops to $89.99
  const price2 = { value: 89.99, currency: 'USD' };

  // Observation 1 of new price
  const step2 = processAntiFlap(price2, state, 3);
  console.log('\nStep 2 - New price observed:');
  console.log('  Candidate count:', step2.result.candidateCount); // 1
  console.log('  Confirmed change:', step2.result.confirmedChange); // false

  state = { ...state, ...step2.newState };

  // Observation 2 of new price
  const step3 = processAntiFlap(price2, state, 3);
  console.log('\nStep 3 - Second observation:');
  console.log('  Candidate count:', step3.result.candidateCount); // 2
  console.log('  Confirmed change:', step3.result.confirmedChange); // false

  state = { ...state, ...step3.newState };

  // Observation 3 of new price - CONFIRMED!
  const step4 = processAntiFlap(price2, state, 3);
  console.log('\nStep 4 - Third observation:');
  console.log('  Confirmed change:', step4.result.confirmedChange); // true
  console.log('  Previous stable:', step4.result.previousStable); // { value: 99.99, currency: 'USD' }
  console.log('  New stable:', step4.result.newStable); // { value: 89.99, currency: 'USD' }
  console.log('  → ALERT: Price changed from $99.99 to $89.99!\n');
}

// Example 2: Flapping scenario
function flappingExample() {
  console.log('\n=== Flapping Scenario Example ===\n');

  let state: RuleState = {
    ruleId: 'flap-test',
    lastStable: { status: 'in_stock', leadTimeDays: 0 },
    candidate: null,
    candidateCount: 0,
    updatedAt: new Date(),
  };

  const inStock = { status: 'in_stock', leadTimeDays: 0 };
  const outOfStock = { status: 'out_of_stock', leadTimeDays: null };

  // Value flaps: in → out → in → out → in
  console.log('Initial stable:', inStock);

  const step1 = processAntiFlap(outOfStock, state, 3);
  console.log('\n1. Out of stock (count: 1)');
  console.log('   Confirmed:', step1.result.confirmedChange); // false
  state = { ...state, ...step1.newState };

  const step2 = processAntiFlap(inStock, state, 3);
  console.log('\n2. Back in stock - candidate reset!');
  console.log('   Candidate:', step2.newState.candidate); // null
  console.log('   Confirmed:', step2.result.confirmedChange); // false
  state = { ...state, ...step2.newState };

  const step3 = processAntiFlap(outOfStock, state, 3);
  console.log('\n3. Out of stock again (count: 1)');
  console.log('   Candidate count:', step3.result.candidateCount); // 1
  state = { ...state, ...step3.newState };

  const step4 = processAntiFlap(inStock, state, 3);
  console.log('\n4. Back in stock - candidate reset again!');
  console.log('   Candidate:', step4.newState.candidate); // null
  state = { ...state, ...step4.newState };

  console.log('\nResult: No alert triggered due to flapping!\n');
}

// Example 3: Immediate confirmation (requireConsecutive=1)
function immediateConfirmationExample() {
  console.log('\n=== Immediate Confirmation Example ===\n');

  let state: RuleState = {
    ruleId: 'immediate-test',
    lastStable: 100,
    candidate: null,
    candidateCount: 0,
    updatedAt: new Date(),
  };

  const { result } = processAntiFlap(200, state, 1);

  console.log('Stable value: 100');
  console.log('New value: 200');
  console.log('Require consecutive: 1');
  console.log('\nResult:');
  console.log('  Confirmed change:', result.confirmedChange); // true
  console.log('  Previous stable:', result.previousStable); // 100
  console.log('  New stable:', result.newStable); // 200
  console.log('  → With requireConsecutive=1, change confirmed immediately!\n');
}

// Run examples
if (require.main === module) {
  priceMonitoringExample();
  flappingExample();
  immediateConfirmationExample();
}
