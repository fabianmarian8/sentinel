const { execSync } = require('child_process');

// Get git commit hash at build time
let gitCommitHash = 'dev';
try {
  gitCommitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch (e) {
  // Git not available or not a git repo
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sentinel/shared'],
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://sentinel.taxinearme.sk/api',
    NEXT_PUBLIC_VERSION: gitCommitHash,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  // OneSignal proxy is handled by Cloudflare Pages Function at /functions/api/onesignal/
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
