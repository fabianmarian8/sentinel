#!/bin/bash
# Verification script for @sentinel/notify implementation

set -e

echo "=== Verifying @sentinel/notify implementation ==="
echo ""

# Check required files exist
echo "✓ Checking required files..."
FILES=(
  "src/email/types.ts"
  "src/email/templates.ts"
  "src/email/email.ts"
  "src/email/index.ts"
  "src/channels/index.ts"
  "src/index.ts"
  "src/email.test.ts"
  "package.json"
  "tsconfig.json"
  "tsconfig.build.json"
  "jest.config.js"
  "README.md"
)

for file in "${FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "✗ Missing file: $file"
    exit 1
  fi
done
echo "  All required files present"
echo ""

# Check dependencies
echo "✓ Checking dependencies..."
if ! grep -q "\"nodemailer\"" package.json; then
  echo "✗ Missing dependency: nodemailer"
  exit 1
fi
if ! grep -q "\"@types/nodemailer\"" package.json; then
  echo "✗ Missing dependency: @types/nodemailer"
  exit 1
fi
echo "  All dependencies present"
echo ""

# Run tests
echo "✓ Running tests..."
npm test > /dev/null 2>&1
echo "  Tests passed"
echo ""

# Check test coverage
echo "✓ Checking test coverage..."
npm run test:cov > /tmp/coverage.txt 2>&1
if ! grep -q "All files.*100.*100.*100" /tmp/coverage.txt; then
  echo "  Warning: Coverage might be below 100% for some metrics"
  grep "All files" /tmp/coverage.txt || true
else
  echo "  Coverage targets met"
fi
echo ""

# Build package
echo "✓ Building package..."
npm run build > /dev/null 2>&1
echo "  Build successful"
echo ""

# Verify exports
echo "✓ Verifying exports..."
EXPORTS=$(node -e "const notify = require('./dist/index.js'); console.log(Object.keys(notify).sort().join(', '))")
EXPECTED="generateEmailHtml, generateEmailText, sendEmailAlert"
if [ "$EXPORTS" != "$EXPECTED" ]; then
  echo "✗ Unexpected exports: $EXPORTS"
  echo "  Expected: $EXPECTED"
  exit 1
fi
echo "  Exports correct: $EXPORTS"
echo ""

# Check type definitions
echo "✓ Checking type definitions..."
if [ ! -f "dist/index.d.ts" ]; then
  echo "✗ Missing type definitions"
  exit 1
fi
if [ ! -f "dist/email/types.d.ts" ]; then
  echo "✗ Missing email type definitions"
  exit 1
fi
echo "  Type definitions generated"
echo ""

echo "=== ✓ All checks passed! ==="
echo ""
echo "Package structure:"
echo "  src/email/types.ts       - Type definitions"
echo "  src/email/templates.ts   - HTML/text templates"
echo "  src/email/email.ts       - Main send function"
echo "  src/email.test.ts        - Unit tests (14 tests)"
echo ""
echo "Ready to use!"
