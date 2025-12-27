// Smart fetch usage examples
import { smartFetch } from './smart-fetch';

/**
 * Example 1: Basic usage with automatic fallback
 */
async function example1() {
  const result = await smartFetch({
    url: 'https://example.com',
  });

  if (result.success) {
    console.log('Fetched using:', result.modeUsed); // 'http' or 'headless'
    console.log('Fallback triggered:', result.fallbackTriggered);
    if (result.fallbackReason) {
      console.log('Reason:', result.fallbackReason);
    }
    console.log('HTML length:', result.html?.length);
  }
}

/**
 * Example 2: Force headless mode (for known SPA sites)
 */
export async function example2() {
  const result = await smartFetch({
    url: 'https://react-spa.example.com',
    preferredMode: 'headless', // Skip HTTP entirely
    renderWaitMs: 3000, // Wait 3s for JS to render
  });

  console.log('Mode used:', result.modeUsed); // Always 'headless'
}

/**
 * Example 3: Disable fallback (HTTP-only mode)
 */
export async function example3() {
  const result = await smartFetch({
    url: 'https://example.com',
    fallbackToHeadless: false, // Never fallback to headless
  });

  // If HTTP fails, result.success will be false
  // but we won't automatically retry with headless
  console.log('HTTP-only result:', result.success);
}

/**
 * Example 4: With custom headless options
 */
export async function example4() {
  const result = await smartFetch({
    url: 'https://example.com',
    // These options only apply if headless mode is used
    renderWaitMs: 5000,
    waitForSelector: '.main-content',
    screenshotOnChange: true,
    screenshotPath: '/tmp/screenshot.png',
  });

  if (result.fallbackTriggered) {
    console.log('Fell back to headless:', result.fallbackReason);
  }
}

/**
 * Example 5: Handling different outcomes
 */
export async function example5() {
  const result = await smartFetch({
    url: 'https://example.com',
  });

  // Check what happened
  if (!result.success) {
    console.error('Fetch failed:', result.errorCode, result.errorDetail);
  } else if (result.fallbackTriggered) {
    console.log(`HTTP failed (${result.fallbackReason}), but headless succeeded`);
  } else {
    console.log('HTTP succeeded on first try');
  }

  // Use the HTML regardless of which mode was used
  if (result.html) {
    // Process HTML...
  }
}

// Run examples
if (require.main === module) {
  example1().catch(console.error);
}
