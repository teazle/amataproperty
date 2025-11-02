#!/bin/bash

# Simple test script for PropertyGuru - 1 page
export PG_MAX_PAGES=1
export PG_DISTRICTS=09
export PG_MIN_PRICE=1000000
export PG_MAX_PRICE=3000000

echo "🧪 Testing PropertyGuru scraper - 1 page"
echo "============================================================"
echo "District: $PG_DISTRICTS"
echo "Pages: $PG_MAX_PAGES"
echo "Price range: \$$PG_MIN_PRICE - \$$PG_MAX_PRICE"
echo "============================================================"
echo ""

cd "$(dirname "$0")/.." || exit 1

bun src/workers/pg.districts.ts

