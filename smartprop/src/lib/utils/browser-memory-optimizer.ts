/**
 * Browser Memory Optimization Utilities
 * 
 * Based on Playwright best practices and production deployment recommendations:
 * - Use resource blocking instead of memory limits that could break functionality
 * - Monitor memory usage and restart browsers when needed
 * - Implement proper cleanup to prevent orphaned processes
 */

import type { Browser, BrowserContext, Page } from 'playwright';

/**
 * Optimized Chromium launch arguments for memory efficiency
 * These flags reduce memory usage without breaking functionality
 */
export const MEMORY_OPTIMIZED_CHROMIUM_ARGS = [
  '--disable-dev-shm-usage', // Use /tmp instead of /dev/shm (prevents crashes on low-memory systems)
  '--no-sandbox', // Required for headless on Linux
  '--disable-setuid-sandbox', // Required for headless on Linux
  '--disable-gpu', // Disable GPU (not needed for headless)
  '--disable-software-rasterizer', // Reduce memory usage
  '--disable-extensions', // Disable extensions (not needed for scraping)
  '--disable-breakpad', // Avoid crashpad traps on low-memory hosts
  '--no-zygote', // Disable zygote process (reduces memory overhead)
  '--disable-component-update', // Disable component updates
  '--disable-background-networking', // Disable background networking
  '--disable-background-timer-throttling', // Disable background timers
  '--disable-backgrounding-occluded-windows', // Disable backgrounding
  '--disable-renderer-backgrounding', // Disable renderer backgrounding
  '--disable-features=TranslateUI', // Disable translation UI
  '--disable-ipc-flooding-protection', // Disable IPC flooding protection
  // Note: We DON'T set --max-old-space-size here because:
  // 1. It's for Node.js V8 heap, not Chromium
  // 2. Setting it too low can break JavaScript execution
  // 3. Chromium manages its own memory better without this flag
];

/**
 * Block unnecessary resources to reduce memory usage
 * This is more effective than memory limits and doesn't break functionality
 */
export async function blockUnnecessaryResources(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const resourceType = route.request().resourceType();
    const url = route.request().url();
    
    // Block resources that consume memory but aren't needed for scraping
    // Keep: document, script, xhr, fetch (needed for dynamic content)
    // Block: image, stylesheet, font, media (consume memory but not needed for most scraping)
    const blockTypes = ['image', 'stylesheet', 'font', 'media'];
    
    if (blockTypes.includes(resourceType)) {
      route.abort();
    } else {
      route.continue();
    }
  });
}

/**
 * Monitor page memory usage and return metrics
 */
export async function getPageMemoryMetrics(page: Page): Promise<{
  jsHeapSize: number; // MB
  jsHeapUsed: number; // MB
  totalHeapSize: number; // MB
}> {
  try {
    const metrics = await page.evaluate(() => {
      if ('memory' in performance) {
        const mem = (performance as any).memory;
        return {
          jsHeapSize: mem.jsHeapSizeLimit / 1024 / 1024, // MB
          jsHeapUsed: mem.usedJSHeapSize / 1024 / 1024, // MB
          totalHeapSize: mem.totalJSHeapSize / 1024 / 1024, // MB
        };
      }
      return { jsHeapSize: 0, jsHeapUsed: 0, totalHeapSize: 0 };
    });
    return metrics;
  } catch (error) {
    // Performance.memory might not be available in all contexts
    return { jsHeapSize: 0, jsHeapUsed: 0, totalHeapSize: 0 };
  }
}

/**
 * Check if page memory usage exceeds threshold
 * Returns true if memory usage is too high and browser should be restarted
 */
export async function shouldRestartBrowser(
  page: Page,
  thresholdMB: number = 1024 // Default: 1GB
): Promise<boolean> {
  try {
    const metrics = await getPageMemoryMetrics(page);
    return metrics.jsHeapUsed > thresholdMB;
  } catch {
    // If we can't get metrics, don't restart
    return false;
  }
}

/**
 * Request garbage collection on a page
 * Useful for detecting and managing memory leaks
 */
export async function requestPageGC(page: Page): Promise<void> {
  try {
    // Playwright 1.48+ has requestGC method
    if ('requestGC' in page && typeof (page as any).requestGC === 'function') {
      await (page as any).requestGC();
    } else {
      // Fallback: trigger GC by evaluating a script that creates and releases memory
      await page.evaluate(() => {
        // Force garbage collection if available
        if ('gc' in window && typeof (window as any).gc === 'function') {
          (window as any).gc();
        }
      });
    }
  } catch (error) {
    // GC request might fail, ignore
    console.warn('[BrowserMemoryOptimizer] GC request failed:', error);
  }
}

/**
 * Create a memory-optimized browser context
 * Applies resource blocking and memory optimizations
 */
export async function createOptimizedContext(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0] = {}
): Promise<BrowserContext> {
  const context = await browser.newContext({
    ...options,
    // Reduce viewport size if not specified (smaller = less memory)
    viewport: options.viewport || { width: 1280, height: 720 },
  });
  
  return context;
}

/**
 * Create a memory-optimized page with resource blocking
 */
export async function createOptimizedPage(
  context: BrowserContext,
  blockResources: boolean = true
): Promise<Page> {
  const page = await context.newPage();
  
  if (blockResources) {
    await blockUnnecessaryResources(page);
  }
  
  return page;
}

/**
 * Memory optimization configuration
 */
export interface MemoryOptimizationConfig {
  /** Block images, CSS, fonts, and media (recommended for most scraping) */
  blockUnnecessaryResources: boolean;
  /** Memory threshold in MB to trigger browser restart (default: 1024) */
  memoryThresholdMB: number;
  /** Request GC periodically (default: false, can help detect leaks) */
  periodicGC: boolean;
  /** GC interval in milliseconds (default: 60000 = 1 minute) */
  gcIntervalMs: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryOptimizationConfig = {
  blockUnnecessaryResources: true,
  memoryThresholdMB: 1024,
  periodicGC: false, // Disabled by default as it can impact performance
  gcIntervalMs: 60000,
};

