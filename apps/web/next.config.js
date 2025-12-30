/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sentinel/shared'],
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://sentinel.taxinearme.sk/api',
  },
  // Proxy OneSignal API requests through Cloudflare Worker to bypass ad blockers
  async rewrites() {
    return [
      {
        source: '/api/onesignal/:path*',
        destination: 'https://onesignal-proxy.fabianmarian8.workers.dev/:path*',
      },
    ];
  },
  // Fix aggressive Cloudflare caching
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
