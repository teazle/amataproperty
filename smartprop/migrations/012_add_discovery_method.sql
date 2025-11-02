-- Add discovery_method column to scraped_articles table
-- This tracks whether the article was discovered via API or DOM scraping

ALTER TABLE scraped_articles
ADD COLUMN discovery_method VARCHAR(10) DEFAULT 'unknown';

-- Add comment for documentation
COMMENT ON COLUMN scraped_articles.discovery_method IS 'Method used to discover the article (api, dom, or unknown)';

-- Update the articles_with_content view to include the new column
DROP VIEW IF EXISTS articles_with_content;

CREATE VIEW articles_with_content AS
SELECT 
    a.*,
    c.text_content,
    c.paragraphs,
    c.links,
    c.word_count,
    c.reading_time_minutes,
    c.main_image_url,
    c.main_image_caption,
    c.html_content,
    c.images,
    c.tags,
    c.scraped_at as content_scraped_at
FROM scraped_articles a
LEFT JOIN article_full_content c ON a.nid = c.nid;
