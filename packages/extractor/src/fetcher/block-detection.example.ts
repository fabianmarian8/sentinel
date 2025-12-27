// Example usage of block detection
import { detectBlock, blockTypeToErrorCode } from './block-detection';

// Example 1: Cloudflare challenge
const cloudflareExample = () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Just a moment...</title></head>
      <body>
        <div id="cf-wrapper">
          <div class="cf-browser-verification">
            <noscript>
              <h1 data-translate="turn_on_js" style="color:#bd2426;">
                Please turn JavaScript on and reload the page.
              </h1>
            </noscript>
            <div id="cf-content">
              <h2 data-translate="checking_browser">Checking your browser before accessing example.com.</h2>
              <p data-translate="process_is_automatic">This process is automatic. Your browser will redirect to your requested content shortly.</p>
              <p data-translate="allow_5_secs">Please allow up to 5 seconds…</p>
            </div>
          </div>
        </div>
        <script>
          (function(){
            window._cf_chl_opt={
              cvId: '3',
              cZone: "example.com",
              cType: 'managed',
              cNounce: '12345'
            };
          })();
        </script>
      </body>
    </html>
  `;

  const headers = {
    'cf-ray': '8d1234567890abcd-SJC',
    'cf-cache-status': 'DYNAMIC',
    'server': 'cloudflare',
  };

  const result = detectBlock(200, html, headers);
  console.log('Cloudflare Example:', result);
  // Output: { blocked: true, blockType: 'cloudflare', confidence: 'high', recommendation: '...' }
};

// Example 2: CAPTCHA
const captchaExample = () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Please verify you're human</h1>
        <div class="g-recaptcha" data-sitekey="6LdXXXXXXXXXXXXXXXXXXXXXXXXXXXX"></div>
        <script src="https://www.google.com/recaptcha/api.js" async defer></script>
      </body>
    </html>
  `;

  const result = detectBlock(200, html, {});
  console.log('CAPTCHA Example:', result);
  // Output: { blocked: true, blockType: 'captcha', confidence: 'high', recommendation: '...' }

  if (result.blocked && result.blockType) {
    const errorCode = blockTypeToErrorCode(result.blockType);
    console.log('Error Code:', errorCode); // BLOCK_CAPTCHA_SUSPECTED
  }
};

// Example 3: Rate limiting
const rateLimitExample = () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>429 Too Many Requests</h1>
        <p>You have exceeded the rate limit. Please try again in 60 seconds.</p>
      </body>
    </html>
  `;

  // HTTP 429 status
  const result = detectBlock(429, html, {});
  console.log('Rate Limit Example:', result);
  // Output: { blocked: true, blockType: 'rate_limit', confidence: 'high', recommendation: '...' }
};

// Example 4: Geo-blocking
const geoBlockExample = () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Access Denied</h1>
        <p>Unfortunately, this content is not available in your country due to licensing restrictions.</p>
      </body>
    </html>
  `;

  const result = detectBlock(403, html, {});
  console.log('Geo-block Example:', result);
  // Output: { blocked: true, blockType: 'geo_block', confidence: 'high', recommendation: '...' }
};

// Example 5: Normal page (not blocked)
const normalPageExample = () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Product - Amazing Widget</title></head>
      <body>
        <div class="product">
          <h1>Amazing Widget</h1>
          <div class="price">$99.99</div>
          <div class="description">
            This is a fantastic product with many features.
            Lorem ipsum dolor sit amet, consectetur adipiscing elit.
          </div>
          <button class="add-to-cart">Add to Cart</button>
        </div>
      </body>
    </html>
  `.repeat(10); // Large enough content

  const result = detectBlock(200, html, {});
  console.log('Normal Page Example:', result);
  // Output: { blocked: false, blockType: null, confidence: 'high', recommendation: null }
};

// Example 6: Integration with fetch result
const fetchIntegrationExample = async () => {
  // Simulated fetch result
  const fetchResult = {
    success: false,
    url: 'https://example.com/product',
    finalUrl: 'https://example.com/product',
    httpStatus: 403,
    contentType: 'text/html' as string | null,
    html: '<html><body>Access Denied</body></html>' as string | null,
    errorCode: null as any,
    errorDetail: null as string | null,
    timings: { total: 250 },
    headers: { 'cf-ray': '8d1234567890abcd-SJC' },
  };

  // Detect block
  const blockDetection = detectBlock(
    fetchResult.httpStatus,
    fetchResult.html,
    fetchResult.headers
  );

  if (blockDetection.blocked) {
    console.log(`\nBlock detected: ${blockDetection.blockType}`);
    console.log(`Confidence: ${blockDetection.confidence}`);
    console.log(`Recommendation: ${blockDetection.recommendation}`);

    // Update fetch result with appropriate error code
    if (blockDetection.blockType) {
      fetchResult.errorCode = blockTypeToErrorCode(blockDetection.blockType);
      fetchResult.errorDetail = `Blocked by ${blockDetection.blockType}`;
    }

    console.log(`Error Code: ${fetchResult.errorCode}`);
  }
};

// Run examples
if (require.main === module) {
  console.log('=== Block Detection Examples ===\n');

  cloudflareExample();
  console.log();

  captchaExample();
  console.log();

  rateLimitExample();
  console.log();

  geoBlockExample();
  console.log();

  normalPageExample();
  console.log();

  fetchIntegrationExample();
}
