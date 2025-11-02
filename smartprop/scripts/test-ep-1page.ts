#!/usr/bin/env bun
/**
 * Test script for EdgeProp scraper - 1 page only
 */

import { config } from 'dotenv';
config();

import * as path from 'path';

// Set test environment variables
process.env.EP_MAX_PAGES = '1';

console.log('🧪 Testing EdgeProp scraper - 1 page');
console.log('='.repeat(60));
console.log(`Pages: ${process.env.EP_MAX_PAGES}`);
console.log('='.repeat(60));
console.log('');

// Import and run the scraper
const scraperPath = path.join(process.cwd(), 'src', 'workers', 'ep.live.ts');
await import(scraperPath);

console.log('\n✅ Test completed!');

