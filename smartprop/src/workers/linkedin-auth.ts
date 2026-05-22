#!/usr/bin/env bun

/**
 * LinkedIn auth bootstrap.
 * Runs the main worker in dry-run mode so login/session state can be established
 * without sending any real messages.
 */

import { automateLinkedInMessages } from './linkedin';

if (process.env.HEADLESS === undefined) {
  process.env.HEADLESS = 'false';
}

if (process.env.LINKEDIN_MAX_MESSAGES === undefined) {
  process.env.LINKEDIN_MAX_MESSAGES = '1';
}

automateLinkedInMessages(true)
  .then((result) => {
    console.log('\n📊 LinkedIn auth bootstrap completed:', result);
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ LinkedIn auth bootstrap failed:', error);
    process.exit(1);
  });
