/**
 * Next.js Instrumentation Hook
 * Runs once at server startup to initialize background services
 */

export async function register() {
  // Skip in Edge runtime
  if (process.env.NEXT_RUNTIME === 'edge') {
    console.log('[Instrumentation] Skipping in Edge runtime');
    return;
  }

  try {
    // Initialize the scraper scheduler with delay to allow database to be ready
    // Use a longer delay to avoid hitting rate limits on startup
    console.log('[Instrumentation] Scheduling scraper scheduler initialization (delayed to avoid rate limits)...');
    setTimeout(async () => {
      try {
        const { initializeScheduler } = await import('@/lib/scheduler/scraper-scheduler');
        await initializeScheduler();
        console.log('[Instrumentation] Scraper scheduler initialized successfully');
      } catch (error: any) {
        // Don't retry if it's a rate limit - that will just make it worse
        if (error?.message?.includes('rate limit') || error?.message?.includes('quota') || error?.message?.includes('exceeded')) {
          console.warn('[Instrumentation] Rate limit hit during initialization. Scheduler will start with empty schedules.');
          console.warn('[Instrumentation] Schedules can be loaded manually via /api/scheduler/reload once rate limits reset.');
        } else {
          console.error('[Instrumentation] Failed to initialize scraper scheduler:', error);
        }
      }
    }, 10000); // Wait 10 seconds before initializing to reduce startup load
  } catch (error) {
    // Log error but don't crash the server
    console.error('[Instrumentation] Failed to schedule scraper scheduler initialization:', error);
  }
}

