/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sentinel/shared'],
  images: {
    unoptimized: true,
  },
  env: {
    API_URL: process.env.API_URL || 'https://sentinel.taxinearme.sk',
  },
};

module.exports = nextConfig;
