/**
 * LinkedIn message tracking utilities
 * Handles database operations for LinkedIn messages and settings
 */

import { getSupabaseClient } from '@/workers/supa';

function getLinkedInDbTimeoutMs(): number {
  const configured = Number(process.env.LINKEDIN_DB_TIMEOUT_MS || 15000);
  return Number.isFinite(configured) && configured > 0 ? configured : 15000;
}

async function withLinkedInDbTimeout<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const timeoutMs = getLinkedInDbTimeoutMs();
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } catch (error: any) {
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export interface LinkedInSettings {
  id: string;
  profile_url: string | null;
  company_url: string;
  daily_limit: number; // Keep for backward compatibility but not used for job stopping
  messages_per_job: number; // New: number of messages to send per job (default 50)
  min_delay: number;
  max_delay: number;
  message_template_profile: string;
  message_template_company: string;
  enabled: boolean;
  auto_run_schedule: string | null;
  timezone: string;
  updated_at: string;
}

export interface LinkedInMessage {
  id: string;
  contact_name: string | null;
  contact_profile_url: string;
  contact_linkedin_id: string | null;
  message_type: 'birthday' | 'work_anniversary' | 'job_change' | null;
  original_template: string | null;
  enhanced_message: string | null;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  sent_at: string | null;
  error_message: string | null;
  linkedin_job_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExistingLinkedInMessageRecord {
  id: string;
  status: LinkedInMessage['status'];
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
}

/**
 * Get LinkedIn settings (singleton - only one row)
 */
export async function getLinkedInSettings(): Promise<LinkedInSettings | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('linkedin_settings')
    .select('*')
    .limit(1)
    .single();

  if (error) {
    console.error('Error fetching LinkedIn settings:', error);
    return null;
  }

  // Ensure messages_per_job has a default value of 50 if null/undefined
  if (data && (data.messages_per_job === null || data.messages_per_job === undefined)) {
    data.messages_per_job = 50;
  }

  return data;
}

/**
 * Update LinkedIn settings
 */
export async function updateLinkedInSettings(
  updates: Partial<LinkedInSettings>
): Promise<LinkedInSettings | null> {
  const supabase = getSupabaseClient();

  // Get existing settings
  const existing = await getLinkedInSettings();
  if (!existing) {
    // Create default settings if none exist
    const { data, error } = await supabase
      .from('linkedin_settings')
      .insert([{
        ...updates,
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating LinkedIn settings:', error);
      return null;
    }
    return data;
  }

  // Update existing
  const { data, error } = await supabase
    .from('linkedin_settings')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', existing.id)
    .select()
    .single();

  if (error) {
    console.error('Error updating LinkedIn settings:', error);
    return null;
  }

  return data;
}

/**
 * Check if contact was already messaged (within last 30 days)
 * Only returns true if message was actually SENT (not skipped)
 */
export async function wasContactMessaged(
  contactProfileUrl: string
): Promise<boolean> {
  const supabase = getSupabaseClient();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  console.log(`   🔍 Checking if ${contactProfileUrl} was messaged in last 30 days...`);

  // Check for ANY record with this profile URL - we should never send to the same person twice
  const { data, error } = await supabase
    .from('linkedin_messages')
    .select('id, status, sent_at, created_at')
    .eq('contact_profile_url', contactProfileUrl)
    .limit(1);

  if (error) {
    console.error('   ❌ Error checking contact message history:', error);
    return false; // If error, allow message (safer)
  }

  const hasRecord = (data?.length ?? 0) > 0;
  if (hasRecord) {
    const record = data[0];
    console.log(`   ⚠️  Contact already has record (status: ${record.status}) on ${record.created_at}, skipping`);
    return true; // Any existing record means we've already processed this contact
  } else {
    console.log(`   ✅ Contact not in database, proceeding`);
  }

  return false;
}

/**
 * Get the latest known message record for a contact.
 * Used to prevent accidental duplicate sends across runs.
 */
export async function getLinkedInMessageRecord(
  contactProfileUrl: string
): Promise<ExistingLinkedInMessageRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await withLinkedInDbTimeout<{
    data: ExistingLinkedInMessageRecord | null;
    error: { message: string } | null;
  }>(
    'LinkedIn duplicate-check query',
    async (signal) => await supabase
        .from('linkedin_messages')
        .select('id, status, sent_at, created_at, updated_at, error_message')
        .eq('contact_profile_url', contactProfileUrl)
        .order('updated_at', { ascending: false })
        .limit(1)
        .abortSignal(signal)
        .maybeSingle()
  );

  if (error) {
    console.error('Error fetching LinkedIn message record:', error);
    throw new Error(`LinkedIn duplicate-check query failed: ${error.message}`);
  }

  return data;
}

/**
 * Create LinkedIn message record
 */
export async function createLinkedInMessage(
  message: Omit<LinkedInMessage, 'id' | 'created_at' | 'updated_at'>
): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('linkedin_messages')
    .insert([message])
    .select('id')
    .single();

  if (error) {
    console.error('Error creating LinkedIn message:', error);
    return null;
  }

  return data.id;
}

/**
 * Update LinkedIn message status
 */
export async function updateLinkedInMessage(
  id: string,
  updates: Partial<LinkedInMessage>
): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('linkedin_messages')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) {
    console.error('Error updating LinkedIn message:', error);
    return false;
  }

  return true;
}

/**
 * Get today's message count
 */
export async function getTodayMessageCount(): Promise<number> {
  const supabase = getSupabaseClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count, error } = await withLinkedInDbTimeout<{
    count: number | null;
    error: { message: string } | null;
  }>(
    'LinkedIn daily-count query',
    async (signal) => await supabase
      .from('linkedin_messages')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'sent')
      .gte('sent_at', today.toISOString())
      .abortSignal(signal)
  );

  if (error) {
    console.error('Error getting today message count:', error);
    throw new Error(`LinkedIn daily-count query failed: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Update daily stats
 */
export async function updateDailyStats(
  messagesSent: number,
  messagesFailed: number,
  contactsProcessed: number,
  byType: { birthday: number; work_anniversary: number; job_change: number }
): Promise<void> {
  const supabase = getSupabaseClient();
  const today = new Date().toISOString().split('T')[0];

  const { data: existing } = await supabase
    .from('linkedin_daily_stats')
    .select('messages_sent, messages_failed, contacts_processed, by_type')
    .eq('date', today)
    .maybeSingle();

  const existingByType = (existing?.by_type || {}) as Partial<typeof byType>;

  const { error } = await supabase
    .from('linkedin_daily_stats')
    .upsert([{
      date: today,
      messages_sent: (existing?.messages_sent || 0) + messagesSent,
      messages_failed: (existing?.messages_failed || 0) + messagesFailed,
      contacts_processed: (existing?.contacts_processed || 0) + contactsProcessed,
      by_type: {
        birthday: (existingByType.birthday || 0) + byType.birthday,
        work_anniversary: (existingByType.work_anniversary || 0) + byType.work_anniversary,
        job_change: (existingByType.job_change || 0) + byType.job_change
      },
      updated_at: new Date().toISOString()
    }], {
      onConflict: 'date'
    });

  if (error) {
    console.error('Error updating daily stats:', error);
  }
}
