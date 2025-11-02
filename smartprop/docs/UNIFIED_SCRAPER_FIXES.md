# EdgeProp Unified Scraper API Intercept Fixes

## Overview
Fixed multiple issues with the API intercept method in the EdgeProp unified scraper for articles.

## Issues Fixed

### 1. **Overly Broad URL Matching**
- **Problem**: The original intercept caught too many responses, not just EdgeProp API calls
- **Fix**: Added precise targeting for specific EdgeProp API endpoints:
  - `/api/property-news`
  - `/api/search` 
  - `/property-news-search`
  - URLs containing `page=` and `page_size=` parameters

### 2. **Poor Error Handling**
- **Problem**: Errors were not properly caught and logged
- **Fix**: 
  - Added comprehensive try-catch blocks
  - Improved error messages with context
  - Fixed variable name conflicts in error handlers
  - Added validation for API response structure

### 3. **Inefficient Data Processing**
- **Problem**: All responses were processed instead of filtering for relevant API calls
- **Fix**: 
  - Added request interception to log actual API calls being made
  - Improved response filtering to only process JSON responses from EdgeProp
  - Added validation to ensure captured data contains valid article structures

### 4. **Missing Progress Updates**
- **Problem**: Limited feedback during API data waiting
- **Fix**: 
  - Added progress updates during API data waiting (every 3 attempts)
  - Extended wait time from 10 to 15 attempts (30 seconds total)
  - Better status messages for different stages

### 5. **Weak Content Validation**
- **Problem**: Articles with insufficient content were still processed
- **Fix**: 
  - Added minimum content length validation (50 characters)
  - Better logging for skipped articles
  - Improved error reporting for failed article scraping

## Key Improvements

### Enhanced API Interception
```typescript
// More precise targeting
const isEdgePropAPI = status === 200 && 
  contentType.includes('json') && (
    url.includes('/api/property-news') ||
    url.includes('/api/search') ||
    url.includes('/property-news-search') ||
    (url.includes('edgeprop.sg') && 
     (url.includes('search') || url.includes('news') || url.includes('api')) &&
     url.includes('page=') && url.includes('page_size='))
  );
```

### Better Error Handling
```typescript
// Proper error variable naming and logging
} catch (error) {
  console.error(`❌ Failed to scrape article ${article.nid}:`, 
    error instanceof Error ? error.message : String(error));
  articlesFailed++;
  
  // Update progress to show failure
  onProgress({...});
}
```

### Request Logging
```typescript
// Added request interception to debug actual API calls
await currentPage.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  
  if (url.includes('edgeprop.sg') && (url.includes('api') || url.includes('search') || url.includes('news'))) {
    console.log('🔍 Intercepted request:', request.method(), url);
  }
  
  await route.continue();
});
```

## Testing

A test script has been created at `scripts/test-unified-scraper-fix.ts` to verify the fixes work properly.

### Running the Test
```bash
cd smartprop
bun run scripts/test-unified-scraper-fix.ts
```

## Expected Results

With these fixes, the scraper should:
1. ✅ Properly intercept EdgeProp API responses
2. ✅ Provide better error handling and logging
3. ✅ Give more accurate progress updates
4. ✅ Validate article content before processing
5. ✅ Handle navigation errors gracefully
6. ✅ Provide better debugging information

## Files Modified

- `src/lib/scraper/edgeprop-unified-scraper.ts` - Main fixes
- `scripts/test-unified-scraper-fix.ts` - Test script (new)
- `docs/UNIFIED_SCRAPER_FIXES.md` - This documentation (new)
