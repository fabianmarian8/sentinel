#!/bin/bash
set -e

echo "🧹 Building fresh..."
rm -rf .next .vercel
npm run build

echo "📤 Deploying with cache bust..."
# Deploy s force flag pre bypass cache
npx wrangler pages deploy .vercel/output/static \
  --project-name=sentinel-app \
  --branch=main \
  --commit-hash=$(date +%s)

echo "✅ Deployment complete! Wait 30s for propagation..."
sleep 30

echo "🔍 Testing production..."
curl -sI https://sentinel.taxinearme.sk/ | grep -E "cache|age|cf-"

echo ""
echo "🎯 Done! Browser cache bypass: Cmd+Shift+R"
