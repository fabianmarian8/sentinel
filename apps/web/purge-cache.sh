#!/bin/bash
set -e

echo "🔥 Purging Cloudflare cache..."

# Option 1: Purge via Pages re-deploy
echo "Method 1: Triggering new deployment..."
npx wrangler pages deployment create \
  --project-name=sentinel-app \
  --branch=main

echo ""
echo "✅ Cache purge initiated!"
echo ""
echo "📝 If browser still shows old version:"
echo "1. Clear browser cache: Cmd+Shift+Delete (Mac)"
echo "2. Disable cache in DevTools: F12 → Network tab → Disable cache"
echo "3. Open incognito window"
echo ""
echo "⏰ Wait 60s for Cloudflare edge propagation"
