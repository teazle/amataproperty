'use server';

import { revalidatePath } from 'next/cache';
import * as db from '@/lib/db/articles';

export async function getArticlesAction(
  page: number = 1,
  search?: string,
  category?: string
) {
  try {
    const result = await db.getArticles(page, 50, search, category);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getScrapeHistoryAction(limit: number = 50) {
  try {
    const sessions = await db.getScrapeHistory(limit);
    return { success: true, data: sessions };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getSessionDetailsAction(sessionId: string) {
  try {
    const details = await db.getSessionDetails(sessionId);
    return { success: true, data: details };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getArticleStatsAction() {
  try {
    const stats = await db.getArticleStats();
    return { success: true, data: stats };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function deleteArticleAction(articleId: string) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE!
    );
    
    await supabase
      .from('scraped_articles')
      .delete()
      .eq('id', articleId);
    
    revalidatePath('/admin/articles');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function deleteScrapeSessionAction(sessionId: string) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE!
    );
    
    // Delete the session (this will cascade delete related records due to foreign key constraints)
    await supabase
      .from('scrape_sessions')
      .delete()
      .eq('id', sessionId);
    
    revalidatePath('/admin/articles');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function deleteAllHistoryAction() {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE!
    );
    
    // Delete all scrape sessions (this will cascade delete related records)
    await supabase
      .from('scrape_sessions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all records
    
    revalidatePath('/admin/articles');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

