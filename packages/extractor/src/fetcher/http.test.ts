// HTTP fetcher tests
import { fetchHttp } from './http';

describe('fetchHttp', () => {
  it('should fetch a valid URL successfully', async () => {
    const result = await fetchHttp({
      url: 'https://example.com',
    });

    expect(result.success).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.html).toBeTruthy();
    expect(result.errorCode).toBeNull();
  }, 30000); // 30s timeout for network request

  it('should handle 404 errors', async () => {
    const result = await fetchHttp({
      url: 'https://httpbin.org/status/404',
    });

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(404);
    expect(result.errorCode).toBe('FETCH_HTTP_4XX');
  }, 30000);

  it('should handle timeouts', async () => {
    const result = await fetchHttp({
      url: 'https://httpbin.org/delay/10',
      timeout: 1000, // 1s timeout
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('FETCH_TIMEOUT');
  }, 30000);

  it('should handle DNS errors', async () => {
    const result = await fetchHttp({
      url: 'https://this-domain-does-not-exist-12345.com',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('FETCH_DNS');
  }, 30000);

  it('should capture response headers', async () => {
    const result = await fetchHttp({
      url: 'https://example.com',
    });

    expect(result.headers).toBeDefined();
    expect(result.headers['content-type']).toBeDefined();
  }, 30000);

  it('should capture timing information', async () => {
    const result = await fetchHttp({
      url: 'https://example.com',
    });

    expect(result.timings.total).toBeGreaterThan(0);
  }, 30000);
});
