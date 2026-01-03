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

    it('should return timeout for timeout error', () => {
      const result = determineFetchOutcome(undefined, undefined, undefined, 'Request timeout ETIMEDOUT');
      expect(result.outcome).toBe('timeout');
    });
  });
});
