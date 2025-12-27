// Smart fetch tests
import { smartFetch } from './smart-fetch';
import * as httpModule from './http';
import * as headlessModule from './headless';
import * as blockDetection from './block-detection';
import * as spaDetection from './spa-detection';

// Mock dependencies
jest.mock('./http');
jest.mock('./headless');
jest.mock('./block-detection');
jest.mock('./spa-detection');

describe('smartFetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('preferredMode: headless', () => {
    it('should skip HTTP and go straight to headless', async () => {
      const mockHeadlessResult = {
        success: true,
        url: 'https://example.com',
        finalUrl: 'https://example.com',
        httpStatus: 200,
        contentType: 'text/html',
        html: '<html>Content</html>',
        errorCode: null,
        errorDetail: null,
        timings: { total: 1000 },
        headers: {},
      };

      (headlessModule.fetchHeadless as jest.Mock).mockResolvedValue(mockHeadlessResult);

      const result = await smartFetch({
        url: 'https://example.com',
        preferredMode: 'headless',
      });

      expect(headlessModule.fetchHeadless).toHaveBeenCalledTimes(1);
      expect(httpModule.fetchHttp).not.toHaveBeenCalled();
      expect(result.modeUsed).toBe('headless');
      expect(result.fallbackTriggered).toBe(false);
    });
  });

  describe('HTTP success - no fallback needed', () => {
    it('should use HTTP when successful and no blocks detected', async () => {
      const mockHttpResult = {
        success: true,
        url: 'https://example.com',
        finalUrl: 'https://example.com',
        httpStatus: 200,
        contentType: 'text/html',
        html: '<html><body>Good content here with lots of text</body></html>',
        errorCode: null,
        errorDetail: null,
        timings: { total: 500 },
        headers: {},
      };

      (httpModule.fetchHttp as jest.Mock).mockResolvedValue(mockHttpResult);
      (blockDetection.detectBlock as jest.Mock).mockReturnValue({
        blocked: false,
        blockType: null,
        confidence: 'high',
        recommendation: null,
      });
      (spaDetection.isJavaScriptRequired as jest.Mock).mockReturnValue(false);

      const result = await smartFetch({
        url: 'https://example.com',
      });

      expect(httpModule.fetchHttp).toHaveBeenCalledTimes(1);
      expect(headlessModule.fetchHeadless).not.toHaveBeenCalled();
      expect(result.modeUsed).toBe('http');
      expect(result.fallbackTriggered).toBe(false);
      expect(result.success).toBe(true);
    });
  });

  describe('HTTP failed - fallback to headless', () => {
    it('should fallback when HTTP fails', async () => {
      const mockHttpResult = {
        success: false,
        url: 'https://example.com',
        finalUrl: 'https://example.com',
        httpStatus: null,
        contentType: null,
        html: null,
        errorCode: 'FETCH_TIMEOUT',
        errorDetail: 'Request timeout',
        timings: { total: 15000 },
        headers: {},
      };

      const mockHeadlessResult = {
        success: true,
        url: 'https://example.com',
        finalUrl: 'https://example.com',
        httpStatus: 200,
        contentType: 'text/html',
        html: '<html>Content</html>',
        errorCode: null,
        errorDetail: null,
        timings: { total: 3000 },
        headers: {},
      };

      (httpModule.fetchHttp as jest.Mock).mockResolvedValue(mockHttpResult);
      (headlessModule.fetchHeadless as jest.Mock).mockResolvedValue(mockHeadlessResult);

      const result = await smartFetch({
        url: 'https://example.com',
      });

      expect(httpModule.fetchHttp).toHaveBeenCalledTimes(1);
      expect(headlessModule.fetchHeadless).toHaveBeenCalledTimes(1);
      expect(result.modeUsed).toBe('headless');
      expect(result.fallbackTriggered).toBe(true);
      expect(result.fallbackReason).toContain('FETCH_TIMEOUT');
    });
  });

  describe('Block detected - fallback to headless', () => {
    it('should fallback when Cloudflare block detected', async () => {
      const mockHttpResult = {
        success: true,
        url: 'https://example.com',
        finalUrl: 'https://example.com',
        httpStatus: 403,
        contentType: 'text/html',
        html: '<html>Cloudflare challenge</html>',
        errorCode: null,
        errorDetail: null,
        timings: { total: 500 },
        headers: { 'cf-ray': 'abc123' },
      };

      const mockHeadlessResult = {
        success: true,
        url: 'https://example.com',
        finalUrl: 'https://example.com',
        httpStatus: 200,
        contentType: 'text/html',
        html: '<html>Content after solving challenge</html>',
        errorCode: null,
        errorDetail: null,
        timings: { total: 5000 },
        headers: {},
      };

      (httpModule.fetchHttp as jest.Mock).mockResolvedValue(mockHttpResult);
      (headlessModule.fetchHeadless as jest.Mock).mockResolvedValue(mockHeadlessResult);
      (blockDetection.detectBlock as jest.Mock).mockReturnValue({
        blocked: true,
        blockType: 'cloudflare',
        confidence: 'high',
        recommendation: 'Use headless mode',
      });

      const result = await smartFetch({
        url: 'https://example.com',
      });

      expect(result.modeUsed).toBe('headless');
      expect(result.fallbackTriggered).toBe(true);
      expect(result.fallbackReason).toContain('cloudflare');
    });
  });

  describe('SPA detected - fallback to headless', () => {
    it('should fallback when JavaScript-rendered content detected', async () => {
      const mockHttpResult = {
        success: true,
        url: 'https://example.com',
        finalUrl: 'https://example.com',
        httpStatus: 200,
        contentType: 'text/html',
        html: '<html><body><div id="root"></div><script src="app.js"></script></body></html>',
        errorCode: null,
        errorDetail: null,
        timings: { total: 500 },
        headers: {},
      };

      const mockHeadlessResult = {
        success: true,
        url: 'https://example.com',
        finalUrl: 'https://example.com',
        httpStatus: 200,
        contentType: 'text/html',
        html: '<html><body><div id="root">Rendered React content</div></body></html>',
        errorCode: null,
        errorDetail: null,
        timings: { total: 3000 },
        headers: {},
      };

      (httpModule.fetchHttp as jest.Mock).mockResolvedValue(mockHttpResult);
      (headlessModule.fetchHeadless as jest.Mock).mockResolvedValue(mockHeadlessResult);
      (blockDetection.detectBlock as jest.Mock).mockReturnValue({
        blocked: false,
        blockType: null,
        confidence: 'high',
        recommendation: null,
      });
      (spaDetection.isJavaScriptRequired as jest.Mock).mockReturnValue(true);

      const result = await smartFetch({
        url: 'https://example.com',
      });

      expect(result.modeUsed).toBe('headless');
      expect(result.fallbackTriggered).toBe(true);
      expect(result.fallbackReason).toContain('JavaScript-rendered');
    });
  });

  describe('fallbackToHeadless disabled', () => {
    it('should not fallback when disabled', async () => {
      const mockHttpResult = {
        success: false,
        url: 'https://example.com',
        finalUrl: 'https://example.com',
        httpStatus: null,
        contentType: null,
        html: null,
        errorCode: 'FETCH_TIMEOUT',
        errorDetail: 'Request timeout',
        timings: { total: 15000 },
        headers: {},
      };

      (httpModule.fetchHttp as jest.Mock).mockResolvedValue(mockHttpResult);

      const result = await smartFetch({
        url: 'https://example.com',
        fallbackToHeadless: false,
      });

      expect(httpModule.fetchHttp).toHaveBeenCalledTimes(1);
      expect(headlessModule.fetchHeadless).not.toHaveBeenCalled();
      expect(result.modeUsed).toBe('http');
      expect(result.fallbackTriggered).toBe(false);
      expect(result.success).toBe(false);
    });
  });

  describe('headless options passthrough', () => {
    it('should pass headless options when falling back', async () => {
      const mockHttpResult = {
        success: false,
        url: 'https://example.com',
        finalUrl: 'https://example.com',
        httpStatus: null,
        contentType: null,
        html: null,
        errorCode: 'FETCH_TIMEOUT',
        errorDetail: 'Request timeout',
        timings: { total: 15000 },
        headers: {},
      };

      const mockHeadlessResult = {
        success: true,
        url: 'https://example.com',
        finalUrl: 'https://example.com',
        httpStatus: 200,
        contentType: 'text/html',
        html: '<html>Content</html>',
        errorCode: null,
        errorDetail: null,
        timings: { total: 3000 },
        headers: {},
      };

      (httpModule.fetchHttp as jest.Mock).mockResolvedValue(mockHttpResult);
      (headlessModule.fetchHeadless as jest.Mock).mockResolvedValue(mockHeadlessResult);

      await smartFetch({
        url: 'https://example.com',
        renderWaitMs: 5000,
        waitForSelector: '.content',
        screenshotOnChange: true,
        screenshotPath: '/tmp/screenshot.png',
      });

      expect(headlessModule.fetchHeadless).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com',
          renderWaitMs: 5000,
          waitForSelector: '.content',
          screenshotOnChange: true,
          screenshotPath: '/tmp/screenshot.png',
        })
      );
    });
  });
});
