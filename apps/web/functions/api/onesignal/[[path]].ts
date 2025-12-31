// Cloudflare Pages Function - OneSignal API Proxy
// Bypasses ad blockers by proxying requests through same domain

interface Env {}

interface EventContext<E = unknown> {
  request: Request;
  params: Record<string, string | string[]>;
  env: E;
}

type PagesFunction<E = unknown> = (
  context: EventContext<E>
) => Response | Promise<Response>;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, params } = context;

  // Build target URL
  const pathSegments = params.path as string[] | undefined;
  const path = pathSegments ? pathSegments.join('/') : '';
  const url = new URL(request.url);
  const targetUrl = `https://api.onesignal.com/${path}${url.search}`;

  // Clone request with new URL
  const proxyRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'follow',
  });

  // Remove host header to avoid issues
  const headers = new Headers(proxyRequest.headers);
  headers.delete('host');

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    // Clone response and add CORS headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', '*');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy error', details: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// Handle CORS preflight
export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  });
};
