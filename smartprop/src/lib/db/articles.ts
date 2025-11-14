/**
 * Database operations for scraped articles
 */

import { createClient } from '@supabase/supabase-js';

// Validate environment variables before creating client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is required');
}

if (!supabaseServiceRole) {
  throw new Error('SUPABASE_SERVICE_ROLE environment variable is required');
}

const supabase = createClient(
  supabaseUrl,
  supabaseServiceRole
);

export interface Article {
  nid: string;
  title: string;
  thumbnail: string;
  path: string;
  author: string;
  created: string;
  category: string | string[];
  description?: string;
  created_on: string;
  keywords?: string[];
  discovery_method?: string;
}

export interface ScraperArticle extends Article {
  id?: string;
  first_scraped_at?: string;
  last_scraped_at?: string;
  scrape_count?: number;
}

export interface ScrapeSession {
  id: string;
  source: string;
  started_at: string;
  completed_at?: string;
  status: 'running' | 'completed' | 'stopped' | 'error';
  pages_scraped: number;
  articles_scraped: number;
  unique_articles: number;
  duplicates_found: number;
  error_message?: string;
}

// Create a new scrape session
export async function createScrapeSession(): Promise<string> {
  const { data, error } = await supabase
    .from('scrape_sessions')
    .insert({
      source: 'EdgeProp',
      status: 'running',
      pages_scraped: 0,
      articles_scraped: 0,
      unique_articles: 0,
      duplicates_found: 0
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

// Update scrape session progress
export async function updateScrapeSession(
  sessionId: string,
  updates: Partial<ScrapeSession>
) {
  const { error } = await supabase
    .from('scrape_sessions')
    .update(updates)
    .eq('id', sessionId);

  if (error) throw error;
}

// Complete scrape session
export async function completeScrapeSession(
  sessionId: string,
  status: 'completed' | 'stopped' | 'error',
  errorMessage?: string
) {
  const { error } = await supabase
    .from('scrape_sessions')
    .update({
      completed_at: new Date().toISOString(),
      status,
      error_message: errorMessage
    })
    .eq('id', sessionId);

  if (error) throw error;
}

// Upsert articles (insert new, update existing)
// NOTE: We only store each article ONCE in the database (by nid)
// Duplicates are tracked via scrape_count and session links
export async function upsertArticles(
  articles: Article[],
  sessionId: string
): Promise<{ newArticles: number; duplicates: number }> {
  let newArticles = 0;
  let duplicates = 0;

  for (const article of articles) {
    // Check if article exists (efficient query)
    const { data: existing } = await supabase
      .from('scraped_articles')
      .select('id, scrape_count')
      .eq('nid', article.nid)
      .maybeSingle(); // Use maybeSingle to avoid error if not found

    if (existing) {
      // Article already exists - this is a duplicate
      duplicates++;
      
      // Update last seen timestamp, increment scrape count, and refresh content
      await supabase
        .from('scraped_articles')
        .update({
          title: article.title,
          thumbnail: article.thumbnail,
          path: article.path,
          author: article.author,
          created: article.created,
          category: article.category,
          description: article.description,
          created_on: article.created_on,
          keywords: article.keywords,
          discovery_method: article.discovery_method || 'unknown',
          last_scraped_at: new Date().toISOString(),
          scrape_count: existing.scrape_count + 1
        })
        .eq('id', existing.id);

      // Link to session (not new) - only if not already linked
      const { data: existingLink } = await supabase
        .from('scrape_session_articles')
        .select('session_id')
        .eq('session_id', sessionId)
        .eq('article_id', existing.id)
        .maybeSingle();
      
      if (!existingLink) {
        await supabase
          .from('scrape_session_articles')
          .insert({
            session_id: sessionId,
            article_id: existing.id,
            was_new: false
          });
      }
    } else {
      // Article doesn't exist - insert new one
      newArticles++;
      
      const { data: newArticle, error } = await supabase
        .from('scraped_articles')
        .insert({
          nid: article.nid,
          title: article.title,
          thumbnail: article.thumbnail, // URL only, not binary data
          path: article.path,
          author: article.author,
          created: article.created,
          category: article.category,
          description: article.description,
          created_on: article.created_on,
          keywords: article.keywords,
          source: 'EdgeProp',
          discovery_method: article.discovery_method || 'unknown'
        })
        .select('id')
        .single();

      if (error) {
        console.error('Failed to insert article:', error);
        continue;
      }

      if (newArticle) {
        // Link to session (new)
        await supabase
          .from('scrape_session_articles')
          .insert({
            session_id: sessionId,
            article_id: newArticle.id,
            was_new: true
          });
      }
    }
  }

  return { newArticles, duplicates };
}

// Get all articles with pagination
export async function getArticles(
  page: number = 1,
  limit: number = 50,
  search?: string,
  category?: string
) {
  let query = supabase
    .from('scraped_articles')
    .select('*', { count: 'exact' })
    .order('first_scraped_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (search) {
    query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
  }

  if (category && category !== 'all') {
    query = query.contains('category', [category]);
  }

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    articles: data || [],
    total: count || 0,
    pages: Math.ceil((count || 0) / limit)
  };
}

// Get scrape sessions
export async function getScrapeHistory(limit: number = 20) {
  const { data, error } = await supabase
    .from('scrape_sessions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// Get session details with articles
export async function getSessionDetails(sessionId: string) {
  const { data: session, error: sessionError } = await supabase
    .from('scrape_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sessionError) throw sessionError;

  const { data: articles, error: articlesError } = await supabase
    .from('scrape_session_articles')
    .select(`
      was_new,
      scraped_articles (*)
    `)
    .eq('session_id', sessionId);

  if (articlesError) throw articlesError;

  return {
    session,
    articles: articles?.map(a => ({ ...a.scraped_articles, was_new: a.was_new })) || []
  };
}

// Get article statistics
export async function getArticleStats() {
  const { count: articleCount, error } = await supabase
    .from('scraped_articles')
    .select('*', { count: 'exact', head: true });

  if (error) throw error;

  const { count: sessionCount } = await supabase
    .from('scrape_sessions')
    .select('*', { count: 'exact', head: true });

  return {
    totalArticles: articleCount || 0,
    totalSessions: sessionCount || 0
  };
}

