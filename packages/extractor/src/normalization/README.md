# Price Normalization

## Usage

```typescript
import { normalizePrice } from '@sentinel/extractor';
import { PriceNormalization } from '@sentinel/shared';

const config: PriceNormalization = {
  kind: 'price',
  locale: 'sk-SK',
  currency: 'EUR'
};

const result = normalizePrice('1 299,00 €', config);
// { value: 1299.00, currency: 'EUR' }
```

## Features

- **Locale-aware parsing**: Handles Slovak, German, US, and other formats
- **Auto-detection**: Automatically determines decimal/thousand separators based on locale
- **Robust parsing**: Strips currency symbols, handles NBSP and multiple spaces
- **Custom configuration**: Override separators, tokens, and decimal scale

## Supported Locales

| Locale | Decimal | Thousand | Example |
|--------|---------|----------|---------|
| sk-SK  | `,`     | ` ` `.`  | `1 299,00 €` |
| de-DE  | `,`     | `.`      | `1.299,00 EUR` |
| en-US  | `.`     | `,`      | `$1,299.00` |

## Configuration

```typescript
interface PriceNormalization {
  kind: "price";
  locale: string;           // "sk-SK", "en-US", "de-DE"
  currency: string;         // "EUR", "USD"
  decimalSeparator?: "," | ".";
  thousandSeparators?: string[];
  stripTokens?: string[];   // ["€", "EUR"]
  scale?: number;           // Default: 2
}
```

## Examples

```typescript
// Slovak format
normalizePrice("1 299,99 €", { kind: "price", locale: "sk-SK", currency: "EUR" })
// → { value: 1299.99, currency: "EUR" }

// US format
normalizePrice("$1,299.99", { kind: "price", locale: "en-US", currency: "USD" })
// → { value: 1299.99, currency: "USD" }

// German format
normalizePrice("1.299,99 EUR", { kind: "price", locale: "de-DE", currency: "EUR" })
// → { value: 1299.99, currency: "EUR" }

// Custom scale
normalizePrice("1299.995", { kind: "price", locale: "en-US", currency: "EUR", scale: 3 })
// → { value: 1299.995, currency: "EUR" }

// Invalid input
normalizePrice("invalid", { kind: "price", locale: "sk-SK", currency: "EUR" })
// → null
```
