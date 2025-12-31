export interface Env {
  BACKEND_URL: string;
  ALLOWED_ORIGINS?: string; // Comma-separated list of allowed origins
}

// Default allowed origins for Sentinel
const DEFAULT_ALLOWED_ORIGINS = [
  'https://sentinel-app.pages.dev',
  'https://sentinel-app-biv.pages.dev',
  'https://sentinel.taxinearme.sk',
  'chrome-extension://', // Allow Chrome extension
];

function isOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;

  // Parse custom allowed origins from env if provided
  const customOrigins = env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];
  const allAllowedOrigins = [...DEFAULT_ALLOWED_ORIGINS, ...customOrigins];

  // Check exact match or prefix match (for chrome-extension://)
  return allAllowedOrigins.some(allowed =>
    origin === allowed || origin.startsWith(allowed)
  );
}

function getCorsHeaders(origin: string | null, env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };

  // Only set Allow-Origin if origin is in allowed list
  if (origin && isOriginAllowed(origin, env)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }

  return headers;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const backendUrl = `${env.BACKEND_URL}${url.pathname}${url.search}`;
    const origin = request.headers.get('Origin');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: getCorsHeaders(origin, env),
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

      // Add CORS headers
      const corsHeaders = getCorsHeaders(origin, env);
      for (const [key, value] of Object.entries(corsHeaders)) {
        newResponse.headers.set(key, value);
      }

      return newResponse;
    } catch (error) {
      const corsHeaders = getCorsHeaders(origin, env);
      return new Response(JSON.stringify({ error: 'Backend unavailable' }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }
  },
};
