/**
 * Alternative Cloudflare bypass methods when Flaresolverr fails
 * Uses direct browser-based bypass techniques
 */

import { Page } from 'playwright-ghost';

/**
 * Wait for Cloudflare challenge to auto-resolve using browser automation
 * This method doesn't require Flaresolverr - uses direct browser interaction
 */
export async function waitForCloudflareAutoResolve(
  page: Page,
  maxWaitTime: number = 180000, // 3 minutes
  checkInterval: number = 5000 // Check every 5 seconds
): Promise<boolean> {
  console.log('   🔄 Waiting for Cloudflare to auto-resolve (browser-based)...');

  const startTime = Date.now();
  let lastContentLength = 0;
  let stableCount = 0;

  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Get current page state
      const pageText = await page.textContent('body').catch(() => '') || '';
      const pageLength = pageText.length;
      const currentUrl = page.url();

      // Check for Cloudflare indicators
      const hasCloudflare =
        pageText.includes('Just a moment') ||
        pageText.includes('Checking your browser') ||
        pageText.includes('Pardon Our Interruption') ||
        pageText.includes('cf-browser-verification') ||
        pageLength < 10000;

      // If no Cloudflare and content is substantial, we're good
      if (!hasCloudflare && pageLength > 10000) {
        console.log(`   ✅ Cloudflare resolved! Page content: ${pageLength} chars`);
        return true;
      }

      // Track if content is changing (indicates page is loading)
      if (pageLength !== lastContentLength) {
        lastContentLength = pageLength;
        stableCount = 0;
        console.log(`   ⏳ Cloudflare challenge detected (${pageLength} chars), waiting...`);
      } else {
        stableCount++;
        // If content hasn't changed in 3 checks, try to trigger interaction
        if (stableCount >= 3) {
          console.log('   🔄 Content stable, attempting to trigger Cloudflare completion...');
          await triggerCloudflareCompletion(page);
          stableCount = 0;
        }
      }

      // Wait before next check
      await page.waitForTimeout(checkInterval);

    } catch (error) {
      console.log(`   ⚠️  Error checking page state: ${error instanceof Error ? error.message : String(error)}`);
      await page.waitForTimeout(checkInterval);
    }
  }

  console.log(`   ❌ Cloudflare did not resolve within ${maxWaitTime / 1000}s`);
  return false;
}

/**
 * Attempt to trigger Cloudflare challenge completion through browser interaction
 */
async function triggerCloudflareCompletion(page: Page): Promise<void> {
  try {
    // Try multiple methods to trigger Cloudflare completion
    await page.evaluate(() => {
      // Method 1: Trigger window events
      window.dispatchEvent(new Event('load'));
      window.dispatchEvent(new Event('DOMContentLoaded'));

      // Method 2: Try to find and interact with any challenge elements
      const challengeElements = document.querySelectorAll('[id*="challenge"], [class*="challenge"], [id*="cf-"], [class*="cf-"]');
      challengeElements.forEach((el: Element) => {
        if (el instanceof HTMLElement) {
          // Try clicking if it's clickable
          if (el.offsetParent !== null) {
            el.click();
          }
        }
      });

      // Method 3: Trigger any pending JavaScript
      if (typeof (window as any).cf !== 'undefined') {
        // Cloudflare's challenge object might exist
        try {
          (window as any).cf();
        } catch (e) {
          // Ignore
        }
      }
    });

    // Small delay after interaction
    await page.waitForTimeout(2000);

    // Try scrolling to trigger lazy loading
    await page.evaluate(() => {
      window.scrollTo(0, 100);
      setTimeout(() => window.scrollTo(0, 0), 500);
    });

  } catch (error) {
    // Ignore errors - this is best-effort
  }
}

/**
 * Enhanced browser-based Cloudflare bypass
 * Uses stealth techniques and waits for auto-resolution
 */
export async function bypassCloudflareDirect(
  page: Page,
  url: string,
  maxWaitTime: number = 180000
): Promise<boolean> {
  console.log('   🛡️  Attempting direct Cloudflare bypass (no Flaresolverr)...');

  try {
    // Navigate to the page
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Wait for Cloudflare to auto-resolve
    const resolved = await waitForCloudflareAutoResolve(page, maxWaitTime);

    if (resolved) {
      // Verify we can access the page
      const finalText = await page.textContent('body').catch(() => '') || '';
      if (finalText.length > 10000) {
        console.log('   ✅ Direct bypass successful!');
        return true;
      }
    }

    return false;
  } catch (error) {
    console.log(`   ⚠️  Direct bypass failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
