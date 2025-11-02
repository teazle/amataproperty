#!/usr/bin/env bun
/**
 * Clean up duplicate test properties, keep only the latest ones
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

async function cleanupTestProperties() {
  console.log('🧹 Cleaning up duplicate test properties...\n');
  
  // Get all test-related listings
  const { data: listings, error } = await supabase
    .from('listings')
    .select('id, title, url, scraped_at')
    .or('url.ilike.%test%,title.ilike.%test%')
    .order('scraped_at', { ascending: false });
  
  if (error) {
    console.error('❌ Error fetching listings:', error);
    process.exit(1);
  }
  
  if (!listings || listings.length === 0) {
    console.log('No test properties found');
    return;
  }
  
  console.log(`📊 Found ${listings.length} test-related listings\n`);
  
  // Keep only the latest 4 test properties (the ones we want)
  const keepUrls = [
    'https://test.example.com/property/2345',
    'https://test.example.com/property/3', 
    'https://test.example.com/property/4',
    'https://test.example.com/property/5'
  ];
  
  const toDelete = listings.filter(listing => !keepUrls.includes(listing.url));
  
  if (toDelete.length === 0) {
    console.log('✅ No duplicate test properties to clean up');
    return;
  }
  
  console.log(`🗑️  Deleting ${toDelete.length} old test properties:\n`);
  
  for (const listing of toDelete) {
    console.log(`   Deleting: ${listing.title}`);
    console.log(`   URL: ${listing.url}`);
    
    const { error: deleteError } = await supabase
      .from('listings')
      .delete()
      .eq('id', listing.id);
    
    if (deleteError) {
      console.error(`   ❌ Error deleting ${listing.title}:`, deleteError);
    } else {
      console.log(`   ✅ Deleted successfully`);
    }
    console.log();
  }
  
  console.log('🎉 Cleanup complete!');
  console.log(`   Kept: ${keepUrls.length} test properties`);
  console.log(`   Deleted: ${toDelete.length} old test properties`);
}

// Run the cleanup
cleanupTestProperties().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
