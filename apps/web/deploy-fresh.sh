#!/bin/bash
set -e

echo "🧹 Cleaning old builds..."
rm -rf .next .vercel node_modules/.cache

echo "📦 Building with cache headers fix..."
npm run build

echo "📤 Deploying to Cloudflare Pages..."
npx wrangler pages deploy .vercel/output/static \
  --project-name=sentinel-app \
  --branch=main \
  --commit-dirty=true

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🔄 Cache bypass steps:"
echo "1. Hard refresh browser: Cmd+Shift+R (Mac) / Ctrl+Shift+R (Windows)"
echo "2. Or open incognito window"
echo ""
echo "🔍 Test deployment:"
echo "curl -sI https://sentinel.taxinearme.sk/ | grep -i cache"
echo ""
echo "⏰ Wait 30-60s for full propagation across Cloudflare edge network"
