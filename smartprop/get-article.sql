SELECT id, title, url, content, images, author, publish_date, category 
FROM scraped_articles 
WHERE content IS NOT NULL AND content != '' 
LIMIT 1;