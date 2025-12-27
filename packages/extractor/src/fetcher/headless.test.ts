// Playwright headless fetcher integration tests
import { fetchHeadless, closeBrowser } from './headless';
import * as fs from 'fs';
import * as path from 'path';

// Skip tests in CI without browsers installed
const shouldSkip = process.env.CI === 'true' && !process.env.PLAYWRIGHT_BROWSERS_PATH;

describe('fetchHeadless', () => {
  // Use jest.setTimeout for longer browser operations
  jest.setTimeout(30000);

  // Clean up browser after all tests
  afterAll(async () => {
    await closeBrowser();
  });

  if (shouldSkip) {
    it.skip('skipping headless tests in CI without browsers', () => {});
    return;
  }

  it('should fetch a simple HTML page', async () => {
    const result = await fetchHeadless({
      url: 'https://example.com',
    });

    expect(result.success).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.html).toContain('Example Domain');
    expect(result.finalUrl).toBe('https://example.com/');
  });

  it('should wait for specific selector', async () => {
    const result = await fetchHeadless({
      url: 'https://example.com',
      waitForSelector: 'h1',
    });

    expect(result.success).toBe(true);
    expect(result.html).toContain('<h1>');
  });

  it('should handle render wait time', async () => {
    const startTime = Date.now();
    const result = await fetchHeadless({
      url: 'https://example.com',
      renderWaitMs: 1000,
    });
    const elapsed = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(1000);
  });

  it('should block resources when requested', async () => {
    const result = await fetchHeadless({
      url: 'https://example.com',
      blockResources: ['image', 'stylesheet', 'font'],
    });

    expect(result.success).toBe(true);
    // Resource blocking doesn't fail the request, just makes it faster
  });

  it('should take screenshot when requested', async () => {
    const screenshotPath = path.join(__dirname, '../../temp-test-screenshot.png');

    // Clean up any existing screenshot
    if (fs.existsSync(screenshotPath)) {
      fs.unlinkSync(screenshotPath);
    }

    const result = await fetchHeadless({
      url: 'https://example.com',
      screenshotOnChange: true,
      screenshotPath,
    });

    expect(result.success).toBe(true);
    expect(result.screenshotPath).toBe(screenshotPath);
    expect(fs.existsSync(screenshotPath)).toBe(true);

    // Clean up
    if (fs.existsSync(screenshotPath)) {
      fs.unlinkSync(screenshotPath);
    }
  });

  it('should handle timeout errors', async () => {
    const result = await fetchHeadless({
      url: 'https://httpbin.org/delay/10',
      timeout: 2000,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('FETCH_TIMEOUT');
  });

  it('should handle DNS errors', async () => {
    const result = await fetchHeadless({
      url: 'https://this-domain-definitely-does-not-exist-12345.com',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('FETCH_DNS');
  });

  it('should handle connection errors', async () => {
    const result = await fetchHeadless({
      url: 'https://localhost:9999',
      timeout: 2000,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('FETCH_CONNECTION');
  });

  it('should set custom user agent', async () => {
    const customUA = 'Mozilla/5.0 Custom Test Agent';
    const result = await fetchHeadless({
      url: 'https://httpbin.org/user-agent',
      userAgent: customUA,
    });

    expect(result.success).toBe(true);
    expect(result.html).toContain(customUA);
  });

  it('should set cookies', async () => {
    const result = await fetchHeadless({
      url: 'https://httpbin.org/cookies',
      cookies: [
        { name: 'test_cookie', value: 'test_value', domain: '.httpbin.org', path: '/' }
      ],
    });

    expect(result.success).toBe(true);
    expect(result.html).toContain('test_cookie');
    expect(result.html).toContain('test_value');
  });

  it('should capture response headers', async () => {
    const result = await fetchHeadless({
      url: 'https://example.com',
    });

    expect(result.success).toBe(true);
    expect(result.headers).toBeDefined();
    expect(result.contentType).toContain('text/html');
  });

  it('should handle redirects and capture final URL', async () => {
    const result = await fetchHeadless({
      url: 'http://github.com',
    });

    expect(result.success).toBe(true);
    expect(result.finalUrl).toContain('https://');
  });
});
