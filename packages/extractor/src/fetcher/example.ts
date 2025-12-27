// Example usage of HTTP fetcher
import { fetchHttp, getRandomUserAgent } from './index';

async function main() {
  console.log('--- Example 1: Basic fetch ---');
  const result1 = await fetchHttp({
    url: 'https://example.com',
  });

  console.log('Success:', result1.success);
  console.log('HTTP Status:', result1.httpStatus);
  console.log('Content-Type:', result1.contentType);
  console.log('HTML length:', result1.html?.length ?? 0);
  console.log('Timings:', result1.timings);
  console.log();

  console.log('--- Example 2: With custom options ---');
  const result2 = await fetchHttp({
    url: 'https://httpbin.org/get',
    timeout: 10000,
    userAgent: getRandomUserAgent(),
    headers: {
      'Accept-Language': 'sk-SK,sk;q=0.9',
    },
  });

  console.log('Success:', result2.success);
  console.log('Final URL:', result2.finalUrl);
  console.log();

  console.log('--- Example 3: Handling errors ---');
  const result3 = await fetchHttp({
    url: 'https://httpbin.org/status/404',
  });

  console.log('Success:', result3.success);
  console.log('Error Code:', result3.errorCode);
  console.log('Error Detail:', result3.errorDetail);
}

main().catch(console.error);
