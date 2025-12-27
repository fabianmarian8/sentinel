import { extract } from './extract';
import { ExtractionConfig } from '@sentinel/shared';

describe('extract - CSS selector', () => {
  it('should extract text content with CSS selector', () => {
    const html = '<span class="price">€ 1,299</span>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: '.price',
      attribute: 'text',
      postprocess: [{ op: 'trim' }],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result).toEqual({
      success: true,
      value: '€ 1,299',
      selectorUsed: '.price',
      fallbackUsed: false,
    });
  });

  it('should extract attribute value with CSS selector', () => {
    const html = '<div data-price="1299" class="product"></div>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: '.product',
      attribute: 'attr:data-price',
      postprocess: [],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result).toEqual({
      success: true,
      value: '1299',
      selectorUsed: '.product',
      fallbackUsed: false,
    });
  });

  it('should extract HTML content', () => {
    const html = '<div class="content"><strong>Bold</strong> text</div>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: '.content',
      attribute: 'html',
      postprocess: [],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.success).toBe(true);
    expect(result.value).toContain('<strong>Bold</strong>');
  });

  it('should use fallback selector when primary fails', () => {
    const html = '<div data-price="1299"></div>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: '.price', // not found
      attribute: 'attr:data-price',
      postprocess: [],
      fallbackSelectors: [
        { method: 'css', selector: '[data-price]' },
      ],
    };

    const result = extract(html, config);

    expect(result).toEqual({
      success: true,
      value: '1299',
      selectorUsed: '[data-price]',
      fallbackUsed: true,
    });
  });

  it('should try multiple fallbacks in order', () => {
    const html = '<div id="price">999</div>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: '.price', // not found
      attribute: 'text',
      postprocess: [],
      fallbackSelectors: [
        { method: 'css', selector: '[data-price]' }, // not found
        { method: 'css', selector: '#price' }, // found
      ],
    };

    const result = extract(html, config);

    expect(result).toEqual({
      success: true,
      value: '999',
      selectorUsed: '#price',
      fallbackUsed: true,
    });
  });

  it('should fail when selector not found', () => {
    const html = '<div>content</div>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: '.nonexistent',
      attribute: 'text',
      postprocess: [],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result).toEqual({
      success: false,
      value: null,
      selectorUsed: '.nonexistent',
      fallbackUsed: false,
      error: 'Selector not found or returned empty value',
    });
  });

  it('should work with context selector', () => {
    const html = `
      <div class="product">
        <span class="name">Product A</span>
        <span class="price">100</span>
      </div>
      <div class="product">
        <span class="name">Product B</span>
        <span class="price">200</span>
      </div>
    `;
    const config: ExtractionConfig = {
      method: 'css',
      selector: '.price',
      attribute: 'text',
      postprocess: [{ op: 'trim' }],
      fallbackSelectors: [],
      context: '.product:first-child',
    };

    const result = extract(html, config);

    expect(result.success).toBe(true);
    expect(result.value).toBe('100');
  });
});

describe('extract - XPath selector', () => {
  it('should extract text with XPath', () => {
    const html = '<div><span class="price">€ 500</span></div>';
    const config: ExtractionConfig = {
      method: 'xpath',
      selector: '//span[@class="price"]/text()',
      attribute: 'text',
      postprocess: [],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.success).toBe(true);
    expect(result.value).toBe('€ 500');
  });

  it('should extract element text with XPath', () => {
    const html = '<div><span class="price">€ 500</span></div>';
    const config: ExtractionConfig = {
      method: 'xpath',
      selector: '//span[@class="price"]',
      attribute: 'text',
      postprocess: [],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.success).toBe(true);
    expect(result.value).toBe('€ 500');
  });

  it('should extract attribute with XPath', () => {
    const html = '<div data-price="1500" class="product"></div>';
    const config: ExtractionConfig = {
      method: 'xpath',
      selector: '//div[@class="product"]',
      attribute: 'attr:data-price',
      postprocess: [],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.success).toBe(true);
    expect(result.value).toBe('1500');
  });

  it('should work with XPath context selector', () => {
    const html = `
      <div class="product">
        <span class="price">100</span>
      </div>
      <div class="product">
        <span class="price">200</span>
      </div>
    `;
    const config: ExtractionConfig = {
      method: 'xpath',
      selector: './/span[@class="price"]',
      attribute: 'text',
      postprocess: [],
      fallbackSelectors: [],
      context: '//div[@class="product"][1]',
    };

    const result = extract(html, config);

    expect(result.success).toBe(true);
    expect(result.value).toBe('100');
  });
});

describe('extract - Regex selector', () => {
  it('should extract with regex pattern', () => {
    const html = '<script>var price = 1299;</script>';
    const config: ExtractionConfig = {
      method: 'regex',
      selector: 'var price = (\\d+);',
      attribute: 'text', // not used for regex
      postprocess: [],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result).toEqual({
      success: true,
      value: '1299',
      selectorUsed: 'var price = (\\d+);',
      fallbackUsed: false,
    });
  });

  it('should return full match when no capturing group', () => {
    const html = 'Price: €1,299';
    const config: ExtractionConfig = {
      method: 'regex',
      selector: '€[\\d,]+',
      attribute: 'text',
      postprocess: [],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.success).toBe(true);
    expect(result.value).toBe('€1,299');
  });

  it('should fail when regex does not match', () => {
    const html = '<div>content</div>';
    const config: ExtractionConfig = {
      method: 'regex',
      selector: 'price: (\\d+)',
      attribute: 'text',
      postprocess: [],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.success).toBe(false);
    expect(result.value).toBe(null);
  });
});

describe('extract - Postprocessing', () => {
  it('should apply trim operation', () => {
    const html = '<p>  Hello World  </p>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: 'p',
      attribute: 'text',
      postprocess: [{ op: 'trim' }],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.value).toBe('Hello World');
  });

  it('should apply lowercase operation', () => {
    const html = '<p>HELLO WORLD</p>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: 'p',
      attribute: 'text',
      postprocess: [{ op: 'lowercase' }],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.value).toBe('hello world');
  });

  it('should apply uppercase operation', () => {
    const html = '<p>hello world</p>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: 'p',
      attribute: 'text',
      postprocess: [{ op: 'uppercase' }],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.value).toBe('HELLO WORLD');
  });

  it('should collapse whitespace', () => {
    const html = '<p>  Hello   World  </p>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: 'p',
      attribute: 'text',
      postprocess: [{ op: 'collapse_whitespace' }],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.value).toBe('Hello World');
  });

  it('should replace text', () => {
    const html = '<p>€ 1,299</p>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: 'p',
      attribute: 'text',
      postprocess: [
        { op: 'replace', from: '€', to: '' },
        { op: 'replace', from: ',', to: '' },
        { op: 'trim' },
      ],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.value).toBe('1299');
  });

  it('should extract with regex_extract operation', () => {
    const html = '<p>Price: $1,299.99 USD</p>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: 'p',
      attribute: 'text',
      postprocess: [
        { op: 'regex_extract', pattern: '\\$([\\d,]+\\.\\d+)', group: 1 },
      ],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.value).toBe('1,299.99');
  });

  it('should apply multiple postprocess operations in order', () => {
    const html = '<p>  Hello   World  </p>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: 'p',
      attribute: 'text',
      postprocess: [
        { op: 'collapse_whitespace' },
        { op: 'lowercase' },
      ],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.value).toBe('hello world');
  });

  it('should handle complex postprocess pipeline', () => {
    const html = '<div class="price">  PRICE: € 1,299.00  </div>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: '.price',
      attribute: 'text',
      postprocess: [
        { op: 'trim' },
        { op: 'lowercase' },
        { op: 'replace', from: 'price: ', to: '' },
        { op: 'replace', from: '€', to: '' },
        { op: 'trim' },
        { op: 'replace', from: ',', to: '' },
      ],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.value).toBe('1299.00');
  });
});

describe('extract - Edge cases', () => {
  it('should handle empty HTML', () => {
    const config: ExtractionConfig = {
      method: 'css',
      selector: '.price',
      attribute: 'text',
      postprocess: [],
      fallbackSelectors: [],
    };

    const result = extract('', config);

    expect(result.success).toBe(false);
  });

  it('should handle malformed HTML', () => {
    const html = '<div class="price">1299<div>'; // unclosed tag
    const config: ExtractionConfig = {
      method: 'css',
      selector: '.price',
      attribute: 'text',
      postprocess: [],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    // Cheerio is forgiving with malformed HTML
    expect(result.success).toBe(true);
    expect(result.value).toBe('1299');
  });

  it('should handle nested elements', () => {
    const html = '<div class="price"><span>€</span> 1,299</div>';
    const config: ExtractionConfig = {
      method: 'css',
      selector: '.price',
      attribute: 'text',
      postprocess: [{ op: 'trim' }],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.success).toBe(true);
    expect(result.value).toContain('1,299');
  });

  it('should handle multiple matches and return first', () => {
    const html = `
      <div class="price">100</div>
      <div class="price">200</div>
    `;
    const config: ExtractionConfig = {
      method: 'css',
      selector: '.price',
      attribute: 'text',
      postprocess: [{ op: 'trim' }],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.success).toBe(true);
    expect(result.value).toBe('100');
  });

  it('should handle value attribute on input elements', () => {
    const html = '<input type="text" value="test value" />';
    const config: ExtractionConfig = {
      method: 'css',
      selector: 'input',
      attribute: 'value',
      postprocess: [],
      fallbackSelectors: [],
    };

    const result = extract(html, config);

    expect(result.success).toBe(true);
    expect(result.value).toBe('test value');
  });
});
