#!/usr/bin/env bun
/**
 * Test script for PropertyGuru scraper - 1 page only
 */

import { config } from 'dotenv';
config();

import * as path from 'path';
import * as fs from 'fs';

// Set test environment variables
process.env.PG_MAX_PAGES = '1';
process.env.PG_DISTRICTS = '09'; // District 09 (Orchard, River Valley)
process.env.PG_MIN_PRICE = '1000000';
process.env.PG_MAX_PRICE = '3000000';

console.log('🧪 Testing PropertyGuru scraper - 1 page');
console.log('='.repeat(60));
console.log(`District: ${process.env.PG_DISTRICTS}`);
console.log(`Pages: ${process.env.PG_MAX_PAGES}`);
console.log(`Price range: $${process.env.PG_MIN_PRICE} - $${process.env.PG_MAX_PRICE}`);
console.log('='.repeat(60));
console.log('');

// Import and run the scraper
const scraperPath = path.join(process.cwd(), 'src', 'workers', 'pg.districts.ts');
await import(scraperPath);

console.log('\n✅ Test completed!');

