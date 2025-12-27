# Extraction Engine

Powerful HTML extraction engine with CSS, XPath, and Regex support.

## Features

- **CSS Selectors**: Use cheerio for fast and reliable CSS-based extraction
- **XPath**: Full XPath 1.0 support via xmldom
- **Regex**: Direct regex pattern matching on HTML source
- **Attribute Extraction**: Extract text, HTML, element values, or custom attributes
- **Postprocessing Pipeline**: Chain multiple text transformations
- **Fallback Selectors**: Automatic fallback chain when primary selector fails
- **Context Selectors**: Extract within a parent element scope

## Usage

```typescript
import { extract } from '@sentinel/extractor';

// Basic CSS extraction
const result = extract('<span class="price">€ 1,299</span>', {
  method: 'css',
  selector: '.price',
  attribute: 'text',
  postprocess: [{ op: 'trim' }],
  fallbackSelectors: []
});
// → { success: true, value: '€ 1,299', selectorUsed: '.price', fallbackUsed: false }

// With postprocessing
const result = extract('<span class="price">€ 1,299</span>', {
  method: 'css',
  selector: '.price',
  attribute: 'text',
  postprocess: [
    { op: 'trim' },
    { op: 'replace', from: '€', to: '' },
    { op: 'replace', from: ',', to: '' },
    { op: 'trim' }
  ],
  fallbackSelectors: []
});
// → { success: true, value: '1299', ... }

// With fallback
const result = extract('<div data-price="1299"></div>', {
  method: 'css',
  selector: '.price',
  attribute: 'attr:data-price',
  postprocess: [],
  fallbackSelectors: [
    { method: 'css', selector: '[data-price]' }
  ]
});
// → { success: true, value: '1299', selectorUsed: '[data-price]', fallbackUsed: true }

// XPath extraction
const result = extract('<div><span class="price">€ 500</span></div>', {
  method: 'xpath',
  selector: '//span[@class="price"]/text()',
  attribute: 'text',
  postprocess: [],
  fallbackSelectors: []
});
// → { success: true, value: '€ 500', ... }

// Regex extraction
const result = extract('<script>var price = 1299;</script>', {
  method: 'regex',
  selector: 'var price = (\\d+);',
  attribute: 'text',
  postprocess: [],
  fallbackSelectors: []
});
// → { success: true, value: '1299', ... }
```

## Configuration

### ExtractionConfig

```typescript
interface ExtractionConfig {
  method: "css" | "xpath" | "regex" | "jsonpath";
  selector: string;
  attribute: "text" | "html" | "value" | `attr:${string}`;
  postprocess: PostprocessOp[];
  fallbackSelectors: FallbackSelector[];
  context?: string | null;
}
```

### Attributes

- `text`: Extract inner text (like element.innerText)
- `html`: Extract inner HTML (like element.innerHTML)
- `value`: Extract value attribute (for inputs)
- `attr:name`: Extract custom attribute (e.g., `attr:data-price`)

### Postprocess Operations

Chain multiple operations to transform extracted values:

```typescript
type PostprocessOp =
  | { op: "trim" }                                      // Remove whitespace
  | { op: "lowercase" }                                 // Convert to lowercase
  | { op: "uppercase" }                                 // Convert to uppercase
  | { op: "collapse_whitespace" }                       // Replace multiple spaces with one
  | { op: "replace"; from: string; to: string }         // String replacement
  | { op: "regex_extract"; pattern: string; group: number }; // Extract with regex
```

Example pipeline:

```typescript
postprocess: [
  { op: 'collapse_whitespace' },  // "  Hello   World  " → "Hello World"
  { op: 'lowercase' },            // "Hello World" → "hello world"
]
```

### Context Selectors

Extract within a parent element:

```typescript
const html = `
  <div class="product">
    <span class="price">100</span>
  </div>
  <div class="product">
    <span class="price">200</span>
  </div>
`;

extract(html, {
  method: 'css',
  selector: '.price',
  attribute: 'text',
  postprocess: [],
  fallbackSelectors: [],
  context: '.product:first-child'  // Only extract from first product
});
// → { success: true, value: '100', ... }
```

## Result

```typescript
interface ExtractionResult {
  success: boolean;
  value: string | null;
  selectorUsed: string;
  fallbackUsed: boolean;
  error?: string;
}
```

- `success`: Whether extraction succeeded
- `value`: Extracted value (null if failed)
- `selectorUsed`: Which selector was used (primary or fallback)
- `fallbackUsed`: Whether a fallback selector was used
- `error`: Error message if extraction failed
