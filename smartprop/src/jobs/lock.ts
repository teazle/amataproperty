/**
 * PostgreSQL Advisory Lock utilities
 * Provides wrapper functions for pg_try_advisory_lock and pg_advisory_unlock
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE!;

// Create a client with service role key for admin operations
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Attempts to acquire an advisory lock
 * @param key - The advisory lock key (bigint)
 * @returns Promise<boolean> - true if lock acquired, false if already locked
 */
export async function tryAdvisoryLock(key: number): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('pg_try_advisory_lock', { key });
    
    if (error) {
      console.error('Error acquiring advisory lock:', error);
      return false;
    }
    
    return data === true;
  } catch (error) {
    console.error('Exception in tryAdvisoryLock:', error);
    return false;
  }
}

/**
 * Releases an advisory lock
 * @param key - The advisory lock key (bigint)
 * @returns Promise<boolean> - true if lock released successfully, false otherwise
 */
export async function advisoryUnlock(key: number): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('pg_advisory_unlock', { key });
    
    if (error) {
      console.error('Error releasing advisory lock:', error);
      return false;
    }
    
    return data === true;
  } catch (error) {
    console.error('Exception in advisoryUnlock:', error);
    return false;
  }
}

/**
 * Executes a function with an advisory lock
 * @param key - The advisory lock key
 * @param fn - Function to execute while holding the lock
 * @returns Promise<T> - Result of the function execution
 */
export async function withAdvisoryLock<T>(
  key: number,
  fn: () => Promise<T>
): Promise<T | null> {
  const lockAcquired = await tryAdvisoryLock(key);
  
  if (!lockAcquired) {
    console.log(`Advisory lock ${key} is already held by another process`);
    return null;
  }
  
  try {
    console.log(`Advisory lock ${key} acquired, executing function`);
    const result = await fn();
    return result;
  } finally {
    const unlocked = await advisoryUnlock(key);
    if (unlocked) {
      console.log(`Advisory lock ${key} released successfully`);
    } else {
      console.error(`Failed to release advisory lock ${key}`);
    }
  }
}
