// Example usage of change detection module

import { detectChange } from './detect';
import type {
  NormalizedPrice,
  NormalizedAvailability,
  NormalizedText,
} from '@sentinel/shared';

// Example 1: Price change detection
console.log('=== Price Change Detection ===');
const oldPrice: NormalizedPrice = { value: 99.99, currency: 'EUR' };
const newPrice: NormalizedPrice = { value: 79.99, currency: 'EUR' };

const priceChange = detectChange(oldPrice, newPrice, 'price');
console.log('Price changed:', priceChange.changed);
console.log('Change kind:', priceChange.changeKind);
console.log('Diff summary:', priceChange.diffSummary);
console.log('Percent change:', priceChange.percentChange);
// Output:
// Price changed: true
// Change kind: decreased
// Diff summary: 99.99 → 79.99 EUR (-20.0%)
// Percent change: -20.00200...

// Example 2: Availability change detection
console.log('\n=== Availability Change Detection ===');
const oldAvail: NormalizedAvailability = {
  status: 'in_stock',
  leadTimeDays: null,
};
const newAvail: NormalizedAvailability = {
  status: 'lead_time',
  leadTimeDays: 7,
};

const availChange = detectChange(oldAvail, newAvail, 'availability');
console.log('Availability changed:', availChange.changed);
console.log('Change kind:', availChange.changeKind);
console.log('Diff summary:', availChange.diffSummary);
// Output:
// Availability changed: true
// Change kind: status_change
// Diff summary: in_stock → lead_time (lead time: N/A → 7 days)

// Example 3: Text content change detection
console.log('\n=== Text Change Detection ===');
const oldText: NormalizedText = {
  hash: 'abc123def456',
  snippet: 'Original product description',
};
const newText: NormalizedText = {
  hash: 'xyz789uvw012',
  snippet: 'Updated product description with more details',
};

const textChange = detectChange(oldText, newText, 'text');
console.log('Text changed:', textChange.changed);
console.log('Change kind:', textChange.changeKind);
console.log('Diff summary:', textChange.diffSummary);
// Output:
// Text changed: true
// Change kind: text_diff
// Diff summary: Content changed (+18 chars)

// Example 4: Number change detection
console.log('\n=== Number Change Detection ===');
const oldStock = 50;
const newStock = 125;

const stockChange = detectChange(oldStock, newStock, 'number');
console.log('Stock changed:', stockChange.changed);
console.log('Change kind:', stockChange.changeKind);
console.log('Diff summary:', stockChange.diffSummary);
console.log('Percent change:', stockChange.percentChange);
// Output:
// Stock changed: true
// Change kind: increased
// Diff summary: 50 → 125
// Percent change: 150

// Example 5: No change scenario
console.log('\n=== No Change Scenario ===');
const samePrice1: NormalizedPrice = { value: 100, currency: 'USD' };
const samePrice2: NormalizedPrice = { value: 100, currency: 'USD' };

const noChange = detectChange(samePrice1, samePrice2, 'price');
console.log('Price changed:', noChange.changed);
console.log('Change kind:', noChange.changeKind);
console.log('Diff summary:', noChange.diffSummary);
// Output:
// Price changed: false
// Change kind: null
// Diff summary: null
