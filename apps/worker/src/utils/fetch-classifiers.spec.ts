import { classifyEmpty, classifyBlock, determineFetchOutcome } from './fetch-classifiers';

describe('fetch-classifiers', () => {
  describe('classifyEmpty', () => {
    it('should detect body too small', () => {
      const result = classifyEmpty('<html></html>', 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('body_too_small');
    });

    it('should pass valid HTML', () => {
      const html = '<html><head></head><body>' + 'x'.repeat(3000) + '</body></html>';
      const result = classifyEmpty(html, 'text/html');
      expect(result.isEmpty).toBe(false);
    });

    it('should detect missing HTML markers', () => {
      const text = 'x'.repeat(3000);
      const result = classifyEmpty(text, 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('missing_html_markers');
    });

    it('should detect loading placeholder', () => {
      const html = '<html><body>Loading...' + 'x'.repeat(3000) + '</body></html>';
      const result = classifyEmpty(html, 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('loading_placeholder');
    });

    it('should detect JSON error in HTML', () => {
      const json = '{"error": "Not Found", "message": "Resource does not exist", "data": "' + 'x'.repeat(3000) + '"}';
      const result = classifyEmpty(json, 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('json_error_in_html');
    });
  });

  describe('classifyBlock', () => {
    it('should detect DataDome', () => {
      const html = '<html><script src="https://geo.captcha-delivery.com/captcha/"></script></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('datadome');
    });

    it('should detect Cloudflare', () => {
      const html = '<html><body>Checking your browser before accessing... Ray ID: abc123</body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('cloudflare');
    });

    it('should detect PerimeterX', () => {
      const html = '<html><body><div id="_pxhd">PerimeterX protection active</div></body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('perimeterx');
      expect(result.signals).toContain('perimeterx_detected');
    });

    it('should detect CAPTCHA', () => {
      const html = '<html><body><div class="g-recaptcha">Please verify you are not a robot</div></body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('captcha');
      expect(result.signals).toContain('captcha_detected');
    });

    it('should detect rate limit', () => {
      const html = '<html><body><h1>Too many requests - Rate limit exceeded</h1></body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('rate_limit');
      expect(result.signals).toContain('rate_limit_detected');
    });

    it('should detect unknown/generic block', () => {
      const html = '<html><body><h1>Access Denied</h1><p>You are blocked from accessing this resource.</p></body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('unknown');
      expect(result.signals).toContain('generic_block_detected');
    });

    it('should pass clean HTML', () => {
      const html = '<html><body><h1>Product Page</h1><span class="price">$99.99</span></body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(false);
    });
  });

  describe('determineFetchOutcome', () => {
    it('should return ok for valid response', () => {
      const html = '<html><body>' + 'x'.repeat(5000) + '</body></html>';
      const result = determineFetchOutcome(200, html, 'text/html');
      expect(result.outcome).toBe('ok');
    });

    it('should return empty for too small response', () => {
      const result = determineFetchOutcome(200, '<html></html>', 'text/html');
      expect(result.outcome).toBe('empty');
    });

    it('should return blocked for DataDome', () => {
      const html = '<html><script>datadome</script></html>' + 'x'.repeat(3000);
      const result = determineFetchOutcome(200, html, 'text/html');
      expect(result.outcome).toBe('blocked');
      expect(result.blockKind).toBe('datadome');
    });

    it('should return captcha_required for CAPTCHA', () => {
      const html = '<html><body>Please solve this recaptcha</body></html>' + 'x'.repeat(3000);
      const result = determineFetchOutcome(200, html, 'text/html');
      expect(result.outcome).toBe('captcha_required');
      expect(result.blockKind).toBe('captcha');
    });

    it('should return timeout for timeout error', () => {
      const result = determineFetchOutcome(undefined, undefined, undefined, 'Request timeout ETIMEDOUT');
      expect(result.outcome).toBe('timeout');
    });

    it('should return network_error for connection errors', () => {
      const result = determineFetchOutcome(undefined, undefined, undefined, 'Connection refused ECONNREFUSED');
      expect(result.outcome).toBe('network_error');
      expect(result.signals).toContain('network_error');
    });
  });
});
