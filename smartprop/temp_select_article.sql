SELECT nid, title, path, thumbnail, author, created, category, description 
FROM articles 
WHERE text_content IS NOT NULL 
  AND length(text_content) > 500 
ORDER BY created DESC 
LIMIT 5;