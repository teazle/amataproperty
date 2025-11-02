-- Article Full Content Table
-- Stores complete article HTML and text content
CREATE TABLE IF NOT EXISTS article_full_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES scraped_articles(id) ON DELETE CASCADE,
  
  -- Full content
  html_content TEXT, -- Full HTML of article body
  text_content TEXT, -- Plain text content
  paragraphs JSONB,                 -- Array of paragraph texts
  images JSONB,                     -- Array of image URLs (strings only)
  links JSONB,                      -- Array of {text, url, type}
  
  -- Media (URLs only, not binary)
  main_image_url TEXT,              -- URL to main image
  main_image_caption TEXT,
  
  -- Metadata
  tags JSONB, -- Article tags/keywords
  word_count INTEGER,
  reading_time_minutes INTEGER,
  
  -- Tracking
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Ensure one content record per article
  UNIQUE(article_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_article_content_article_id ON article_full_content(article_id);
CREATE INDEX IF NOT EXISTS idx_article_content_scraped_at ON article_full_content(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_content_word_count ON article_full_content(word_count);
CREATE INDEX IF NOT EXISTS idx_article_content_text_search ON article_full_content USING gin(to_tsvector('english', text_content));
CREATE INDEX IF NOT EXISTS idx_article_content_tags ON article_full_content USING gin(tags);

-- Trigger for updated_at
CREATE TRIGGER update_article_content_updated_at BEFORE UPDATE ON article_full_content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE article_full_content IS 'Stores full article content including HTML, text, and media';
COMMENT ON COLUMN article_full_content.html_content IS 'Complete HTML of article body';
COMMENT ON COLUMN article_full_content.text_content IS 'Plain text version of article';
COMMENT ON COLUMN article_full_content.word_count IS 'Total word count';
COMMENT ON COLUMN article_full_content.reading_time_minutes IS 'Estimated reading time based on 200 words/min';

-- View: Articles with full content
CREATE OR REPLACE VIEW articles_with_content AS
SELECT 
  a.id,
  a.nid,
  a.title,
  a.thumbnail,
  a.path,
  a.author,
  a.category,
  a.description,
  a.first_scraped_at,
  a.scrape_count,
  c.html_content,
  c.text_content,
  c.word_count,
  c.reading_time_minutes,
  c.tags,
  c.scraped_at as content_scraped_at,
  (c.id IS NOT NULL) as has_full_content
FROM scraped_articles a
LEFT JOIN article_full_content c ON a.id = c.article_id;

-- Stats view
CREATE OR REPLACE VIEW article_content_stats AS
SELECT 
  COUNT(*) as total_articles,
  COUNT(CASE WHEN c.id IS NOT NULL THEN 1 END) as articles_with_content,
  COUNT(CASE WHEN c.id IS NULL THEN 1 END) as articles_without_content,
  AVG(c.word_count) as avg_word_count,
  AVG(c.reading_time_minutes) as avg_reading_time,
  SUM(LENGTH(c.html_content)) / 1024 / 1024 as total_content_mb
FROM scraped_articles a
LEFT JOIN article_full_content c ON a.id = c.article_id;

COMMENT ON VIEW articles_with_content IS 'Combined view of articles with their full content';
COMMENT ON VIEW article_content_stats IS 'Statistics about article content scraping';

