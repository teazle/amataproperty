#!/usr/bin/env bun
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
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function debugActivePrompt() {
  console.log('🔍 Checking active AI prompt...\n');

  try {
    const { data: activePrompt, error } = await supabase
      .from('ai_prompts')
      .select('*')
      .eq('is_active', true)
      .single();

    if (error) {
      console.error('❌ Error fetching active prompt:', error);
      return;
    }

    if (!activePrompt) {
      console.log('⚠️ No active prompt found');
      return;
    }

    console.log('✅ Active Prompt Found:');
    console.log(`   ID: ${activePrompt.id}`);
    console.log(`   Name: ${activePrompt.name}`);
    console.log(`   Version: ${activePrompt.version}`);
    console.log(`   Created: ${activePrompt.created_at}`);
    console.log(`   Active: ${activePrompt.is_active}`);
    console.log('\n📝 Prompt Content:');
    console.log('---');
    console.log(activePrompt.prompt_content);
    console.log('---');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugActivePrompt();