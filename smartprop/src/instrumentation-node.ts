export async function registerNodeInstrumentation() {
  try {
    // Initialize the scraper scheduler with delay to allow database to be ready.
    // Use a longer delay to avoid hitting rate limits on startup.
    console.log('[Instrumentation] Scheduling scraper scheduler initialization (delayed to avoid rate limits)...');
    setTimeout(async () => {
      try {
        const { initializeScheduler } = await import('@/lib/scheduler/scraper-scheduler');
        await initializeScheduler();
        console.log('[Instrumentation] Scraper scheduler initialized successfully');
      } catch (error) {
        // Don't retry if it's a rate limit - that will just make it worse.
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('rate limit') || errorMessage.includes('quota') || errorMessage.includes('exceeded')) {
          console.warn('[Instrumentation] Rate limit hit during initialization. Scheduler will start with empty schedules.');
          console.warn('[Instrumentation] Schedules can be loaded manually via /api/scheduler/reload once rate limits reset.');
        } else {
          console.error('[Instrumentation] Failed to initialize scraper scheduler:', error);
        }
      }
    }, 10000);

    // Initialize LinkedIn scheduler with delay to allow database to be ready.
    // The refreshLinkedInScheduler function has built-in retry logic.
    console.log('[Instrumentation] Scheduling LinkedIn scheduler initialization...');
    setTimeout(async () => {
      try {
        const { refreshLinkedInScheduler } = await import('@/lib/linkedin/scheduler');
        await refreshLinkedInScheduler(0);
        console.log('[Instrumentation] LinkedIn scheduler initialization initiated (has retry logic)');
      } catch (error) {
        // refreshLinkedInScheduler handles its own retries, so this should rarely fail.
        console.error('[Instrumentation] Failed to initiate LinkedIn scheduler:', error);
      }
    }, 12000);
  } catch (error) {
    // Log error but don't crash the server.
    console.error('[Instrumentation] Failed to schedule scheduler initialization:', error);
  }
}
