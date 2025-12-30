/**
 * OneSignal API Proxy Worker
 * Proxies requests to api.onesignal.com to bypass ad blockers
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Build target URL to OneSignal API
    const targetUrl = new URL('https://api.onesignal.com' + url.pathname + url.search);

    // Clone request headers
    const headers = new Headers(request.headers);

    // Remove headers that shouldn't be forwarded
    headers.delete('host');

    // Forward the request to OneSignal
    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    // Clone response headers
    const responseHeaders = new Headers(response.headers);

    // Add CORS headers
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, SDK-Version, Authorization');

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: responseHeaders,
      });
    }

    // Return proxied response
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
