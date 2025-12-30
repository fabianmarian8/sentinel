/**
 * OneSignal API Proxy - Cloudflare Pages Function
 * Proxies requests to api.onesignal.com to bypass ad blockers
 * Route: /api/onesignal/*
 */

interface Env {
  // Add any environment variables here if needed
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const url = new URL(request.url);

  // Extract the path after /api/onesignal/
  const pathParts = url.pathname.replace('/api/onesignal/', '');

  // Build target URL to OneSignal API
  const targetUrl = new URL(`https://api.onesignal.com/${pathParts}${url.search}`);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, SDK-Version, Authorization, OneSignal-Subscription-Id',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Clone and modify headers
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ipcountry');
  headers.delete('cf-ray');
  headers.delete('cf-visitor');

  try {
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
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, SDK-Version, Authorization, OneSignal-Subscription-Id');

    // Return proxied response
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('OneSignal proxy error:', error);
    return new Response(JSON.stringify({ error: 'Proxy error', message: String(error) }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};
