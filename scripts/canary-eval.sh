#!/bin/bash
# Canary Eval Script - 24h Protocol
#
# Usage: ./scripts/canary-eval.sh [hours]
# Default: 24 hours
#
# Requires: INTERNAL_API_KEY and API_URL environment variables
# Or uses defaults for local testing

set -e

HOURS=${1:-24}
API_URL=${API_URL:-"https://sentinel.taxinearme.sk"}
API_KEY=${INTERNAL_API_KEY:-"sentinel-internal-2026"}
CANARY_WORKSPACE_ID="11111111-1111-4111-8111-111111111111"

echo "=================================="
echo "🔬 Sentinel Canary Eval Report"
echo "=================================="
echo "Period: ${HOURS}h"
echo "Workspace: ${CANARY_WORKSPACE_ID}"
echo "API: ${API_URL}"
echo ""

# Fetch canary metrics
RESPONSE=$(curl -s -H "X-Internal-Key: ${API_KEY}" \
  "${API_URL}/api/stats/admin/slo/canary?workspaceId=${CANARY_WORKSPACE_ID}&hours=${HOURS}")

if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "null" ]; then
  echo "❌ Failed to fetch canary metrics"
  exit 1
fi

# Parse and display results with jq
echo "📊 Success Rate by Tier"
echo "------------------------"
echo "$RESPONSE" | jq -r '
  .byTier | to_entries[] |
  select(.value.totalRuns > 0) |
  "  \(.key): \(.value.successRate * 100 | floor)% (\(.value.successfulRuns)/\(.value.totalRuns)) - SLO: \(.value.sloTarget * 100)% - Status: \(.value.status)"
'

echo ""
echo "💰 Cost per Success by Tier"
echo "----------------------------"
echo "$RESPONSE" | jq -r '
  .byTier | to_entries[] |
  select(.value.totalRuns > 0) |
  "  \(.key): $\(.value.costPerSuccess | . * 10000 | floor / 10000) (total: $\(.value.totalCostUsd | . * 100 | floor / 100))"
'

echo ""
echo "⚠️  Rate Limited Stats"
echo "----------------------"
echo "$RESPONSE" | jq -r '
  "  Count: \(.rateLimited.count) (\(.rateLimited.percentage * 100 | . * 10 | floor / 10)%)"
'
echo "$RESPONSE" | jq -r '
  .rateLimited.byProvider | to_entries[] |
  "    - \(.key): \(.value)"
'

echo ""
echo "🔴 Worst 5 Hostnames"
echo "--------------------"
echo "$RESPONSE" | jq -r '
  .worstHostnames[:5][] |
  "  \(.hostname) [\(.tier)]: \(.successRate * 100 | floor)% success, \(.attempts) attempts"
' 2>/dev/null || echo "  (no data)"

echo ""
echo "GO/NO-GO Decision"
echo "=================="
CAN_PROCEED=$(echo "$RESPONSE" | jq -r '.goNoGo.canProceed')
if [ "$CAN_PROCEED" = "true" ]; then
  echo "✅ GO - All SLO targets met"
else
  echo "❌ NO-GO - Blockers:"
  echo "$RESPONSE" | jq -r '.goNoGo.blockers[]' | while read blocker; do
    echo "   - $blocker"
  done
fi

echo ""
echo "=================================="
echo "Raw JSON (for Oponent):"
echo "=================================="
echo "$RESPONSE" | jq '.'
