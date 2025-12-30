/**
 * OneSignal Proxy Worker for Cloudflare
 * Bypasses ad blockers by proxying OneSignal requests through your domain
 */

const ONESIGNAL_HOSTS = {
  'cdn': 'cdn.onesignal.com',
  'onesignal': 'onesignal.com',
  'api': 'api.onesignal.com',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Determine target host based on path
    let targetHost = ONESIGNAL_HOSTS.cdn;
    let targetPath = url.pathname;

    // Route /api/* to api.onesignal.com
    if (url.pathname.startsWith('/api/')) {
      targetHost = ONESIGNAL_HOSTS.api;
      targetPath = url.pathname.replace('/api', '');
    }
    // Route /onesignal/* to onesignal.com
    else if (url.pathname.startsWith('/onesignal/')) {
      targetHost = ONESIGNAL_HOSTS.onesignal;
      targetPath = url.pathname.replace('/onesignal', '');
    }
    // Default: /sdks/* and other paths go to cdn.onesignal.com

    const targetUrl = `https://${targetHost}${targetPath}${url.search}`;

    // Create new request with modified URL
    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow',
    });

    try {
      const response = await fetch(modifiedRequest);

      // Clone response and add CORS headers
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      newHeaders.set('Access-Control-Allow-Headers', '*');

      // For JavaScript files, we need to rewrite references to onesignal.com
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('javascript') || contentType.includes('application/json')) {
        let body = await response.text();

        // Get the proxy base URL (the URL of this worker)
        const proxyBase = `${url.protocol}//${url.host}`;

        // Replace OneSignal CDN URLs with proxy URLs
        body = body.replace(/https:\/\/cdn\.onesignal\.com/g, proxyBase);
        body = body.replace(/https:\/\/onesignal\.com/g, `${proxyBase}/onesignal`);
        body = body.replace(/https:\/\/api\.onesignal\.com/g, `${proxyBase}/api`);

        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (error) {
      return new Response(`Proxy error: ${error.message}`, {
        status: 502,
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
