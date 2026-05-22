#!/usr/bin/env bash
# Setup Playwright on EC2 for auth scripts
# Run on EC2: bash scripts/setup-playwright-ec2.sh

set -e
cd "$(dirname "$0")/.."
export PATH="${PATH}:/home/ec2-user/.bun/bin"

echo "📦 Installing Playwright Chromium..."
bunx playwright install chromium 2>/dev/null || npx playwright install chromium

# playwright-ghost may expect chromium-1194; symlink if we have 1193
CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if [ -d "$CACHE/chromium-1193" ] && [ ! -d "$CACHE/chromium-1194" ]; then
  echo "🔗 Creating chromium-1194 -> chromium-1193 symlink..."
  ln -sf chromium-1193 "$CACHE/chromium-1194" 2>/dev/null || true
  ln -sf chromium_headless_shell-1193 "$CACHE/chromium_headless_shell-1194" 2>/dev/null || true
fi

# Also check /tmp (used when running as different user)
TMP_CACHE="/tmp/.cache/ms-playwright"
if [ -d "$TMP_CACHE/chromium-1193" ] && [ ! -d "$TMP_CACHE/chromium-1194" ]; then
  echo "🔗 Creating symlink in $TMP_CACHE..."
  ln -sf chromium-1193 "$TMP_CACHE/chromium-1194" 2>/dev/null || true
  ln -sf chromium_headless_shell-1193 "$TMP_CACHE/chromium_headless_shell-1194" 2>/dev/null || true
fi

echo "✅ Playwright setup done"
