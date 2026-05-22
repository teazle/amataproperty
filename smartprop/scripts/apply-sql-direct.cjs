#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local'), override: false });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env'), override: false });

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error('Usage: node scripts/apply-sql-direct.cjs <migration.sql>');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const password = process.env.SUPABASE_DB_PASSWORD;
const ref = supabaseUrl && (supabaseUrl.match(/https:\/\/([^.]+)/) || [])[1];

if (!ref || !password) {
  console.error('Missing Supabase project ref or SUPABASE_DB_PASSWORD');
  process.exit(1);
}

const sqlPath = path.resolve(process.cwd(), sqlFile);
const sql = fs.readFileSync(sqlPath, 'utf8');
const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;

async function main() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });

  await client.connect();
  await client.query(sql);
  await client.end();
  console.log(JSON.stringify({ success: true, migration: sqlFile }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
