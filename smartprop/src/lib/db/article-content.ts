/**
 * Database operations for article full content
 */

import { createClient } from '@supabase/supabase-js';
import type { ArticleContent } from '../scraper/edgeprop-content-scraper';

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

/**
 * Upsert full article content
 */
export async function upsertArticleContent(content: ArticleContent): Promise<void> {
  let articleId: string | null = null;

  // Prefer stable article path because MCP-generated nids are not stable.
  if (content.path) {
    const rawPath = content.path.trim().replace(/^https?:\/\/(?:www\.)?edgeprop\.sg/i, '').replace(/\/+$/, '');
    const withSlash = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    let normalizedPath = withSlash;
    try {
      normalizedPath = decodeURIComponent(withSlash);
    } catch {
      normalizedPath = withSlash;
    }
    const { data: articleByPath, error: pathError } = await supabase
      .from('scraped_articles')
      .select('id')
      .eq('path', normalizedPath)
      .limit(1)
      .maybeSingle();

    if (pathError) {
      throw pathError;
    }
    articleId = articleByPath?.id || null;
  }

  if (!articleId) {
    const { data: article, error: nidError } = await supabase
      .from('scraped_articles')
      .select('id')
      .eq('nid', content.nid)
      .maybeSingle();

    if (nidError) {
      throw nidError;
    }
    articleId = article?.id || null;
  }
  
  if (!articleId) {
    throw new Error(`Article with nid ${content.nid} or path ${content.path} not found`);
  }
  
  const { error } = await supabase
    .from('article_full_content')
    .upsert({
      article_id: articleId,
      text_content: content.text_content,
      paragraphs: content.paragraphs,
      links: content.links,
      word_count: content.word_count,
      reading_time_minutes: content.reading_time_minutes,
      scraped_at: content.scraped_at.toISOString(),
      // Save images and other metadata (handle both string[] and object[] formats)
      html_content: (content as any).html_content || null,
      images: (content as any).images || null,
      main_image_url: (content as any).main_image_url || content.main_image_url || null,
      main_image_caption: (content as any).main_image_caption || content.main_image_caption || null,
      tags: (content as any).tags || null
    }, {
      onConflict: 'article_id'
    });
  
  if (error) throw error;
}

/**
 * Get full content for an article
 */
export async function getArticleContent(articleId: string) {
  const { data, error } = await supabase
    .from('article_full_content')
    .select('*')
    .eq('article_id', articleId)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error; // Ignore not found
  return data;
}

/**
 * Get articles without full content
 */
export async function getArticlesWithoutContent(limit: number = 100) {
  const { data, error } = await supabase
    .from('scraped_articles')
    .select('id, nid, title, path')
    .is('article_full_content.id', null)
    .limit(limit);
  
  if (error) throw error;
  return data || [];
}

/**
 * Get content statistics
 */
export async function getContentStats() {
  const { data, error } = await supabase
    .from('article_content_stats')
    .select('*')
    .single();
  
  if (error) throw error;
  return data;
}

/**
 * Search articles by full text content
 */
export async function searchArticleContent(
  query: string,
  limit: number = 20
) {
  const { data, error } = await supabase
    .from('articles_with_content')
    .select('*')
    .textSearch('text_content', query, {
      type: 'websearch',
      config: 'english'
    })
    .eq('has_full_content', true)
    .limit(limit);
  
  if (error) throw error;
  return data || [];
}

/**
 * Delete article content
 */
export async function deleteArticleContent(articleId: string) {
  const { error } = await supabase
    .from('article_full_content')
    .delete()
    .eq('article_id', articleId);
  
  if (error) throw error;
}
