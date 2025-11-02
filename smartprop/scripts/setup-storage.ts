#!/usr/bin/env ts-node
/**
 * Setup Supabase Storage bucket for co-broking agreements
 * This script creates the "agreements" bucket if it doesn't exist
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  console.error('❌ Error: Missing required environment variables');
  console.error('Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function setupStorage() {
  console.log('🚀 Setting up Supabase Storage for co-broking agreements...\n');

  try {
    // Check if bucket exists
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    
    if (listError) {
      console.error('❌ Error listing buckets:', listError);
      process.exit(1);
    }

    const agreementsBucket = buckets?.find(b => b.name === 'agreements');

    if (agreementsBucket) {
      console.log('✅ Bucket "agreements" already exists');
      console.log(`   ID: ${agreementsBucket.id}`);
      console.log(`   Public: ${agreementsBucket.public}`);
      console.log(`   Created: ${agreementsBucket.created_at}`);
    } else {
      console.log('📦 Creating "agreements" bucket...');
      
      const { data, error } = await supabase.storage.createBucket('agreements', {
        public: true, // Make PDFs publicly accessible
        fileSizeLimit: 5242880, // 5MB limit
        allowedMimeTypes: ['application/pdf']
      });

      if (error) {
        console.error('❌ Error creating bucket:', error);
        process.exit(1);
      }

      console.log('✅ Successfully created "agreements" bucket');
      console.log(`   Name: ${data.name}`);
    }

    console.log('\n✨ Storage setup complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. PDFs will be automatically uploaded to Supabase Storage');
    console.log('   2. Public URLs will be generated for each agreement');
    console.log('   3. WhatsApp notifications will be sent via Business API\n');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

// Run the setup
setupStorage().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

