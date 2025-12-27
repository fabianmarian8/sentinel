// Pattern constants for block detection

export const CAPTCHA_PATTERNS = [
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /challenge-form/i,
  /verify.*human/i,
  /are you a robot/i,
  /prove.*not.*robot/i,
  /please verify/i,
  /security check/i,
  /complete.*verification/i,
];

export const CLOUDFLARE_PATTERNS = [
  /checking your browser/i,
  /cloudflare/i,
  /cf-browser-verification/i,
  /ray id/i,
  /ddos protection/i,
  /just a moment/i,
  /enable javascript and cookies/i,
  /cloudflare ray id/i,
  /security by cloudflare/i,
  /attention required/i,
];

export const BOT_DETECTION_PATTERNS = [
  /access denied/i,
  /blocked/i,
  /suspicious activity/i,
  /automated access/i,
  /bot detected/i,
  /unauthorized/i,
  /forbidden/i,
  /your access has been blocked/i,
  /unusual activity/i,
  /automated traffic/i,
];

export const GEO_BLOCK_PATTERNS = [
  /not available in your (country|region|location)/i,
  /service.*not available.*country/i,
  /geographic(al)? restriction/i,
  /region.?lock/i,
  /content.*not.*available.*location/i,
];

export const RATE_LIMIT_PATTERNS = [
  /too many requests/i,
  /rate limit/i,
  /slow down/i,
  /request limit exceeded/i,
  /throttled/i,
];

// Minimum HTML size to consider as non-blocked (in bytes)
export const MIN_NORMAL_HTML_SIZE = 5000;

// Cloudflare headers
export const CLOUDFLARE_HEADERS = ['cf-ray', 'cf-cache-status', 'cf-request-id'];

// Other CDN/protection headers
export const PROTECTION_HEADERS = [
  'x-amz-cf-id',  // AWS CloudFront
  'x-sucuri-id',  // Sucuri WAF
  'x-akamai-transformed',  // Akamai
];
