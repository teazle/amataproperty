/**
 * Database operations for article full content
 */

import { createClient } from '@supabase/supabase-js';
import type { ArticleContent } from '../scraper/edgeprop-content-scraper';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

/**
 * Upsert full article content
 */
export async function upsertArticleContent(content: ArticleContent): Promise<void> {
  // Get article_id from nid
  const { data: article } = await supabase
    .from('scraped_articles')
    .select('id')
    .eq('nid', content.nid)
    .single();
  
  if (!article) {
    throw new Error(`Article with nid ${content.nid} not found`);
  }
  
  const { error } = await supabase
    .from('article_full_content')
    .upsert({
      article_id: article.id,
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

