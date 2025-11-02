import { config } from 'dotenv';
config(); // Load environment variables

import { createClient } from '@supabase/supabase-js'

// Supabase client using service key for server-side operations
// This should only be used in server-side code and never exposed to the client
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

// Helper function to get the service role client with proper error handling
export function getSupabaseClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is required')
  }
  
  if (!process.env.SUPABASE_SERVICE_ROLE) {
    throw new Error('SUPABASE_SERVICE_ROLE environment variable is required')
  }
  
  return supabase
}
