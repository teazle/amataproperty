#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local only
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  console.error('Error: Missing required environment variables');
  console.error('Please set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE in .env.local');
  process.exit(1);
}

// Type assertion after validation
const validatedUrl: string = supabaseUrl;
const validatedServiceRole: string = supabaseServiceRole;

const _supabase = createClient(validatedUrl, validatedServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  db: {
    schema: 'public'
  }
});

async function runSqlFile(filePath: string, url: string, serviceRole: string) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  
  if (!fs.existsSync(absolutePath)) {
    console.error(`Error: SQL file not found: ${absolutePath}`);
    process.exit(1);
  }

  console.log(`Reading SQL file: ${filePath}`);
  const sql = fs.readFileSync(absolutePath, 'utf-8');

  console.log('Executing SQL against Supabase...\n');

  try {
    // Use the REST API to execute SQL
    const response = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRole,
        'Authorization': `Bearer ${serviceRole}`
      },
      body: JSON.stringify({ query: sql })
    });

    // If exec_sql doesn't exist, fall back to using the Supabase SQL editor approach
    if (response.status === 404 || !response.ok) {
      console.log('Direct SQL execution via RPC not available, using query approach...\n');
      
      // Split into individual statements and log them
      const statements = sql
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      console.log(`Found ${statements.length} SQL statements to execute.`);
      console.log('Note: Execute these manually in your Supabase SQL editor or use the Supabase CLI.\n');
      
      for (let i = 0; i < statements.length; i++) {
        const preview = statements[i].substring(0, 100).replace(/\s+/g, ' ');
        console.log(`${i + 1}. ${preview}${statements[i].length > 100 ? '...' : ''}`);
      }
      
      const dashboardUrl = url.replace('/v1', '').replace('/rest', '');
      console.log('\n⚠️  For now, please run the migration manually:');
      console.log(`   1. Go to ${dashboardUrl}/project/_/sql/new`);
      console.log(`   2. Copy the contents of ${filePath}`);
      console.log(`   3. Paste and run the SQL`);
      console.log('\nOr install the Supabase CLI and use: supabase db push\n');
      
      return;
    }

    const result = await response.json();
    
    if (result.error) {
      console.error('Error executing SQL:', result.error);
      process.exit(1);
    }

    console.log('✓ SQL executed successfully\n');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error:', errorMessage);
    const dashboardUrl = url.replace('/v1', '').replace('/rest', '');
    console.log('\n⚠️  Could not execute SQL automatically.');
    console.log('Please run the migration manually in your Supabase SQL editor:');
    console.log(`   ${dashboardUrl}/project/_/sql/new\n`);
    process.exit(1);
  }
}

// Get SQL file path from command line arguments
const sqlFile = process.argv[2];

if (!sqlFile) {
  console.error('Usage: ts-node scripts/run-sql.ts <path-to-sql-file>');
  process.exit(1);
}

runSqlFile(sqlFile, validatedUrl, validatedServiceRole);
