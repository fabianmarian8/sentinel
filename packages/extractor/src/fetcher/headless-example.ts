// Example usage of Playwright headless fetcher
import { fetchHeadless } from './headless';

async function main() {
  console.log('Fetching example.com with Playwright...\n');

  // Basic fetch
  const result1 = await fetchHeadless({
    url: 'https://example.com',
    renderWaitMs: 2000,
  });

  console.log('Basic fetch result:');
  console.log('- Success:', result1.success);
  console.log('- HTTP Status:', result1.httpStatus);
  console.log('- Final URL:', result1.finalUrl);
  console.log('- Content Type:', result1.contentType);
  console.log('- Timing:', result1.timings.total, 'ms');
  console.log('- HTML Length:', result1.html?.length || 0, 'chars\n');

  // Fetch with selector wait
  const result2 = await fetchHeadless({
    url: 'https://example.com',
    waitForSelector: 'h1',
    blockResources: ['image', 'stylesheet', 'font'],
  });

  console.log('Fetch with selector wait and resource blocking:');
  console.log('- Success:', result2.success);
  console.log('- Timing:', result2.timings.total, 'ms');
  console.log('- Resources blocked: images, stylesheets, fonts\n');

  // Fetch with screenshot
  const result3 = await fetchHeadless({
    url: 'https://example.com',
    screenshotOnChange: true,
    screenshotPath: '/tmp/example-screenshot.png',
    renderWaitMs: 1000,
  });

  console.log('Fetch with screenshot:');
  console.log('- Success:', result3.success);
  console.log('- Screenshot saved to:', result3.screenshotPath);
  console.log('- Timing:', result3.timings.total, 'ms\n');

  // Handle error case
  const result4 = await fetchHeadless({
    url: 'https://this-domain-does-not-exist-12345.com',
    timeout: 5000,
  });

  console.log('Error handling example:');
  console.log('- Success:', result4.success);
  console.log('- Error Code:', result4.errorCode);
  console.log('- Error Detail:', result4.errorDetail);
  console.log('- Timing:', result4.timings.total, 'ms\n');

  process.exit(0);
}

main().catch(console.error);
