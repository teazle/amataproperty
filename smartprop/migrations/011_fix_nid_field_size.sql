-- Fix NID field size to accommodate longer EdgeProp article IDs
-- EdgeProp NIDs can be longer than 50 characters

ALTER TABLE scraped_articles 
ALTER COLUMN nid TYPE VARCHAR(100);

-- Add comment for documentation
COMMENT ON COLUMN scraped_articles.nid IS 'EdgeProp unique article identifier (up to 100 chars)';
