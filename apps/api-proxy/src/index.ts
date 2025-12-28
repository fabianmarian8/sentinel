export interface Env {
  BACKEND_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const backendUrl = `${env.BACKEND_URL}${url.pathname}${url.search}`;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    try {
      // Forward the request to backend
      const response = await fetch(backendUrl, {
        method: request.method,
        headers: {
          ...Object.fromEntries(request.headers),
          'Host': '135.181.99.192:8080',
        },
        body: request.method !== 'GET' && request.method !== 'HEAD' 
          ? await request.text() 
          : undefined,
      });

      // Create new response with CORS headers
      const newResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });

      newResponse.headers.set('Access-Control-Allow-Origin', '*');
      newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      return newResponse;
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Backend unavailable' }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
