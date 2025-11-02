#!/usr/bin/env bun
/**
 * Check what test properties are currently in the database
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  console.error('❌ Missing required environment variables');
  console.error('Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function checkTestProperties() {
  console.log('🔍 Checking test properties in database...\n');
  
  // Get all listings that contain "test" in the URL or title
  const { data: listings, error } = await supabase
    .from('listings')
    .select('id, title, url, scraped_at')
    .or('url.ilike.%test%,title.ilike.%test%')
    .order('scraped_at', { ascending: false });
  
  if (error) {
    console.error('❌ Error fetching listings:', error);
    process.exit(1);
  }
  
  console.log(`📊 Found ${listings?.length || 0} test-related listings:\n`);
  
  if (listings && listings.length > 0) {
    listings.forEach((listing, index) => {
      console.log(`${index + 1}. ${listing.title}`);
      console.log(`   ID: ${listing.id}`);
      console.log(`   URL: ${listing.url}`);
      console.log(`   Scraped: ${new Date(listing.scraped_at).toLocaleString()}`);
      console.log();
    });
    
    // Check for duplicates by URL
    const urls = listings.map(l => l.url);
    const uniqueUrls = new Set(urls);
    
    if (urls.length !== uniqueUrls.size) {
      console.log('⚠️  DUPLICATE URLs detected!');
      const duplicates = urls.filter((url, index) => urls.indexOf(url) !== index);
      console.log('Duplicate URLs:', [...new Set(duplicates)]);
    } else {
      console.log('✅ No duplicate URLs found');
    }
  } else {
    console.log('No test properties found');
  }
}

// Run the check
checkTestProperties().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
