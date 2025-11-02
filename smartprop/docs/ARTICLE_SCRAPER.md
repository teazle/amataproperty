# 📰 Article Scraper - Complete Guide

## Overview

The Article Scraper is a unified system that scrapes property news from EdgeProp Singapore with full content extraction. It combines metadata discovery with complete article content in a single, efficient process.

## Features

- ✅ **Unified Scraping**: One process that discovers and extracts complete content
- ✅ **Full Content**: HTML, text, images, links, word counts, reading times
- ✅ **Real-time Progress**: Live updates via Server-Sent Events (SSE)
- ✅ **Database Integration**: Persistent storage with deduplication
- ✅ **Search & Filter**: Full-text search across all content
- ✅ **Export Options**: JSON/CSV export capabilities
- ✅ **Session Tracking**: Complete audit trail of all scrapes

## How It Works

### 1. Discovery Phase
- Navigates to EdgeProp news search pages
- Intercepts internal API calls to get article listings
- Discovers 20 articles per page

### 2. Content Extraction Phase
For each discovered article:
- Visits the full article page
- Extracts complete HTML content
- Extracts plain text (~5000 words)
- Extracts all image URLs
- Extracts all links with context
- Calculates word count and reading time
- Saves everything to database
- Respectful 2-second delay between articles

### 3. Database Storage
**Two tables per article:**
- `scraped_articles`: Metadata (title, author, category, etc.)
- `article_full_content`: Full content (HTML, text, images, links)

## Performance

| Pages | Articles | Time | Storage |
|-------|----------|------|---------|
| 1 | 20 | ~1 minute | ~1 MB |
| 5 | 100 | ~5 minutes | ~5 MB |
| 10 | 200 | ~10 minutes | ~10 MB |
| 50 | 1,000 | ~50 minutes | ~50 MB |
| 100 | 2,000 | ~1h 40m | ~100 MB |

**Rate**: ~20 articles/minute (respectful to EdgeProp servers)

## Data Structure

### Metadata (scraped_articles table)
```json
{
  "nid": "5998262",
  "title": "Singapore tops global FDI attractiveness ranking...",
  "path": "property-news/singapore-tops-global-fdi...",
  "thumbnail": "https://img.tepcdn.com/...",
  "author": "Kalynskye Adrian",
  "category": ["News"],
  "description": "Singapore led the pack with average net FDI...",
  "created_on": "1 day ago",
  "keywords": [],
  "source": "EdgeProp"
}
```

### Full Content (article_full_content table)
```json
{
  "html_content": "<div>Singapore has retained its crown...</div>",
  "text_content": "Singapore has retained its crown as the world's...",
  "paragraphs": [
    "Singapore has retained its crown as the world's most attractive...",
    "The study analysed FDI inflows across the world's 30 largest economies...",
    "Despite global headwinds such as geopolitical tensions..."
  ],
  "images": [
    "https://img.tepcdn.com/main-image.jpg",
    "https://img.tepcdn.com/chart-fdi.jpg"
  ],
  "links": [
    { "text": "BrokerChooser", "url": "https://...", "type": "external" },
    { "text": "market trends", "url": "/market-trends", "type": "internal" }
  ],
  "main_image_url": "https://img.tepcdn.com/...",
  "main_image_caption": "Singapore also ranks among the world's top jurisdictions...",
  "tags": ["Foreign Direct Investment", "FDI"],
  "word_count": 487,
  "reading_time_minutes": 3
}
```

## Usage

### Via Web UI
1. Go to http://localhost:3000/admin/articles
2. Set number of pages to scrape (1-644)
3. Click "Start Scraping"
4. Watch real-time progress
5. View results in Library tab

### Via API
```typescript
import { scrapeEdgePropUnified } from '@/lib/scraper/edgeprop-unified-scraper';

const sessionId = await createScrapeSession();

const articles = await scrapeEdgePropUnified(
  5, // Pages to scrape
  (progress) => {
    console.log(`
      Page: ${progress.currentPage}/${progress.totalPages}
      Scraped: ${progress.articlesScraped}
      Failed: ${progress.articlesFailed}
      ${progress.message}
    `);
  },
  sessionId
);
```

### Via Database Queries
```sql
-- Get all articles with full content
SELECT a.title, c.word_count, c.reading_time_minutes
FROM scraped_articles a
JOIN article_full_content c ON a.id = c.article_id
WHERE c.word_count > 500
ORDER BY a.created_at DESC;

-- Full-text search
SELECT a.title, c.text_content
FROM scraped_articles a
JOIN article_full_content c ON a.id = c.article_id
WHERE to_tsvector('english', c.text_content) 
  @@ websearch_to_tsquery('english', 'investment policy');
```

## Database Schema

### scraped_articles
- `id` (UUID) - Primary key
- `nid` (VARCHAR) - EdgeProp article ID (unique)
- `title` (TEXT) - Article headline
- `path` (TEXT) - Article URL path
- `thumbnail` (TEXT) - Image URL
- `author` (VARCHAR) - Author name
- `category` (JSONB) - Categories array
- `description` (TEXT) - Article summary
- `created_on` (VARCHAR) - Human-readable date
- `keywords` (JSONB) - Keywords array
- `source` (VARCHAR) - Always "EdgeProp"
- `first_scraped_at` (TIMESTAMP) - When first found
- `last_scraped_at` (TIMESTAMP) - Last time seen
- `scrape_count` (INTEGER) - Times encountered

### article_full_content
- `id` (UUID) - Primary key
- `article_id` (UUID) - References scraped_articles.id
- `html_content` (TEXT) - Full HTML markup
- `text_content` (TEXT) - Plain text content
- `paragraphs` (JSONB) - Array of paragraphs
- `images` (JSONB) - Array of image URLs
- `links` (JSONB) - Array of links with context
- `main_image_url` (TEXT) - Primary image URL
- `main_image_caption` (TEXT) - Image caption
- `tags` (JSONB) - Article tags
- `word_count` (INTEGER) - Word count
- `reading_time_minutes` (INTEGER) - Estimated reading time
- `scraped_at` (TIMESTAMP) - When content was scraped

### scrape_sessions
- `id` (UUID) - Primary key
- `started_at` (TIMESTAMP) - When scraping started
- `completed_at` (TIMESTAMP) - When scraping finished
- `pages_scraped` (INTEGER) - Number of pages processed
- `articles_scraped` (INTEGER) - Number of articles scraped
- `articles_failed` (INTEGER) - Number of failed articles
- `status` (VARCHAR) - 'running', 'completed', 'failed', 'stopped'
- `error_message` (TEXT) - Error details if failed

## Media Storage Strategy

**URLs Only (Not Binary Files)**
- ✅ Images stored as URL strings (~100 bytes each)
- ✅ Leverages EdgeProp's CDN
- ✅ 1000x smaller database size
- ✅ Fast queries and updates
- ✅ Always shows latest version

**Example:**
```json
{
  "images": [
    "https://img.tepcdn.com/img-v2/a/m-h_628,w_1200,g_cm/5998262/88964928/8a0d4bd5-89d6-452d-b207-e124615d04b2.jpg"
  ],
  "main_image_url": "https://img.tepcdn.com/img-v2/a/m-h_628,w_1200,g_cm/5998262/88964928/8a0d4bd5-89d6-452d-b207-e124615d04b2.jpg"
}
```

## Use Cases

### 1. News Aggregation
- Build property news feeds
- Track trending topics
- Monitor specific authors or categories

### 2. Content Analysis
- Analyze writing patterns
- Track word counts and reading times
- Study image usage patterns

### 3. Full-Text Search
- Search across all article content
- Find articles by specific topics
- Advanced filtering and sorting

### 4. AI Training
- Feed content to language models
- Train custom property news models
- Generate summaries and insights

### 5. Archive & Backup
- Complete article preservation
- Independent of EdgeProp availability
- Historical content analysis

## Troubleshooting

### Common Issues

**1. Scraping Stops Unexpectedly**
- Check browser console for errors
- Verify EdgeProp is accessible
- Check rate limiting (2-second delays)

**2. Database Connection Issues**
- Verify Supabase credentials in `.env`
- Check database migration status
- Ensure tables exist

**3. Memory Issues with Large Scrapes**
- Scrape in smaller batches (10-20 pages)
- Monitor system memory usage
- Consider running on VPS for large scrapes

**4. Content Not Saving**
- Check database permissions
- Verify session creation
- Check for duplicate article IDs

### Performance Optimization

**For Large Scrapes:**
- Use SSD storage for database
- Increase memory allocation
- Run during off-peak hours
- Consider distributed scraping

**For Development:**
- Use small page counts (1-5 pages)
- Enable debug logging
- Test with single articles first

## API Reference

### Start Scraping
```bash
POST /api/articles/scrape
Content-Type: application/json

{
  "maxPages": 10
}
```

### Get Articles
```bash
GET /api/articles?page=1&limit=20&search=investment
```

### Get Session History
```bash
GET /api/articles/sessions
```

### Export Data
```bash
GET /api/articles/export?format=json&sessionId=uuid
GET /api/articles/export?format=csv&sessionId=uuid
```

## Configuration

### Environment Variables
```env
# Database
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE=your_service_role_key

# Scraping
HEADLESS=true
EP_MAX_PAGES=50
SCRAPING_DELAY=2000  # 2 seconds between articles
```

### Rate Limiting
- **Default**: 2 seconds between articles
- **Configurable**: Via `SCRAPING_DELAY` environment variable
- **Respectful**: Won't overwhelm EdgeProp servers

## Monitoring

### Progress Tracking
- Real-time page progress
- Articles scraped vs failed
- Time estimates and speed
- Error reporting

### Database Monitoring
```sql
-- Check scraping progress
SELECT 
  status,
  COUNT(*) as session_count,
  AVG(articles_scraped) as avg_articles
FROM scrape_sessions
GROUP BY status;

-- Check content completeness
SELECT 
  COUNT(*) as total_articles,
  COUNT(c.id) as with_content,
  ROUND(COUNT(c.id)::float / COUNT(*) * 100, 2) as completeness_percent
FROM scraped_articles a
LEFT JOIN article_full_content c ON a.id = c.article_id;
```

## Best Practices

1. **Start Small**: Test with 1-5 pages first
2. **Monitor Progress**: Watch for errors and failures
3. **Regular Backups**: Export data periodically
4. **Respectful Scraping**: Don't overwhelm servers
5. **Error Handling**: Check logs for issues
6. **Storage Management**: Monitor database size
7. **Content Validation**: Verify content quality

---

**The Article Scraper provides complete property news content with professional-grade performance and reliability! 📰✨**
