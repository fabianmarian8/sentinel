# Change Detection Module

Detects and analyzes changes between previous and current values for different data types.

## Features

- **Price Change Detection**: Tracks price increases/decreases with percentage calculation
- **Availability Change Detection**: Monitors stock status and lead time changes
- **Text Change Detection**: Detects content changes via hash comparison
- **Number Change Detection**: Tracks numeric value changes with percentage calculation

## Usage

```typescript
import { detectChange } from '@sentinel/extractor';

// Price change detection
const priceResult = detectChange(
  { value: 100, currency: 'EUR' },
  { value: 120, currency: 'EUR' },
  'price'
);
// Result: { changed: true, changeKind: 'increased', percentChange: 20, diffSummary: '100 → 120 EUR (+20.0%)' }

// Availability change detection
const availResult = detectChange(
  { status: 'in_stock' },
  { status: 'out_of_stock' },
  'availability'
);
// Result: { changed: true, changeKind: 'status_change', diffSummary: 'in_stock → out_of_stock' }

// Text change detection
const textResult = detectChange(
  { hash: 'abc123', snippet: 'Old content' },
  { hash: 'def456', snippet: 'New content' },
  'text'
);
// Result: { changed: true, changeKind: 'text_diff', diffSummary: 'Content changed (+1 chars)' }

// Number change detection
const numberResult = detectChange(100, 150, 'number');
// Result: { changed: true, changeKind: 'increased', percentChange: 50, diffSummary: '100 → 150' }
```

## API

### `detectChange(previousValue, currentValue, ruleType)`

Main function that routes to specific change detectors based on rule type.

**Parameters:**
- `previousValue: any` - Previous value (type depends on ruleType)
- `currentValue: any` - Current value (type depends on ruleType)
- `ruleType: 'price' | 'availability' | 'text' | 'number'` - Type of change detection

**Returns:** `ChangeDetectionResult`

### `ChangeDetectionResult`

```typescript
interface ChangeDetectionResult {
  changed: boolean;
  changeKind: ChangeKind | null;
  diffSummary: string | null;
  percentChange?: number;  // Only for price and number changes
}

type ChangeKind = "increased" | "decreased" | "text_diff" | "status_change" | "unknown";
```

## Individual Detectors

You can also use specific detectors directly:

```typescript
import {
  detectPriceChange,
  detectAvailabilityChange,
  detectTextChange,
  detectNumberChange,
} from '@sentinel/extractor';
```

## Null/Undefined Handling

All detectors safely handle `null` and `undefined` values:

```typescript
detectChange(null, { value: 100, currency: 'EUR' }, 'price');
// Result: { changed: false, changeKind: null, diffSummary: null }
```

## Test Coverage

Comprehensive test suite covers:
- Price increases/decreases with various scenarios
- Availability status and lead time changes
- Text content changes with hash comparison
- Number changes including negative numbers and decimals
- Null/undefined value handling
- Edge cases (zero values, same length content changes, etc.)

Run tests:
```bash
pnpm test detect.test.ts
```
