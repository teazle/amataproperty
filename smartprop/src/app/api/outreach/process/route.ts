import { createOutreachProcessHandler } from '@/lib/matcher/job-handlers';

/**
 * Processes only operator-selected, explicitly confirmed rows. The matcher
 * never calls this endpoint, and the job itself claims delivery before send.
 */
export const POST = createOutreachProcessHandler();
