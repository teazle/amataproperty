# Architecture Comparison: Property Scrapers vs Article Scraper

## 🤔 Why Property Scrapers Work Better

Your observation was spot-on! Let me explain the architecture difference.

## Property Scrapers (PG/EP) - Working Pattern ✅

### Architecture
```
Server Component → Database → Display
      ↓
  Fetch from DB
      ↓
  Show persistent data
```

### Flow
1. **User visits `/admin/scraper`**
2. **Server Component fetches** from `scraper_jobs` and `listings` tables
3. **Data displayed** from database
4. **Scraper runs** → saves directly to `listings` table
5. **Page refresh** → shows updated data from DB ✅

### Why It Works
- ✅ Data persists in database
- ✅ Server Component pattern (fetches on each load)
- ✅ `scraper_jobs` table tracks sessions (like our `scrape_sessions`)
- ✅ SSE only for live progress, not for data persistence

### Code Example
```typescript
// Property scraper page (Server Component)
export default async function ScraperPage() {
  const [activeJob, jobHistory, listings] = await Promise.all([
    getActiveJob(),          // From scraper_jobs
    getJobHistory(),         // From scraper_jobs  
    getListings()           // From listings table
  ]);
  
  return <ScraperDashboard data={listings} />; // Shows DB data
}
```

---

## Article Scraper V1 (Original) - Broken Pattern ❌

### Architecture
```
Client Component → SSE → Memory Only
      ↓
  Keep in state
      ↓
  Lost on refresh ❌
```

### Flow
1. **User visits `/admin/articles`**
2. **Client Component** starts with empty state
3. **Start scrape** → articles sent via SSE
4. **Stored in React state** (memory only)
5. **Page refresh** → all data lost ❌

### Why It Broke
- ❌ Articles only in memory (useState)
- ❌ No database fetch on page load
- ❌ SSE used for both progress AND data storage
- ❌ Client Component pattern (doesn't fetch from DB)

### Code Example (BROKEN)
```typescript
// Old article scraper (Client Component)
'use client';

export default function ArticlesPage() {
  const [articles, setArticles] = useState([]); // Memory only!
  
  // SSE stores in state
  eventSource.onmessage = (event) => {
    setArticles(data.articles); // Lost on refresh!
  };
  
  return <div>{articles.map(...)}</div>; // Shows memory data
}
```

---

## Article Scraper V2 (Fixed) - Correct Pattern ✅

### Architecture
```
Server Component → Database → Display
      ↓                        ↑
  Fetch from DB          Client Component
      ↓                    (tabs + SSE)
  Pass initial data              ↓
                        Updates from DB
```

### Flow
1. **User visits `/admin/articles`**
2. **Server Component fetches** from `scraped_articles` table
3. **Pass initial data** to Client Component
4. **Client Component** manages tabs + live scraping
5. **Scraper runs** → saves to database in real-time
6. **Tab switch / refresh** → fetches latest from DB ✅

### Why It Works Now
- ✅ **Same pattern as property scrapers**
- ✅ Articles persist in `scraped_articles` table
- ✅ Server Component fetches on page load
- ✅ `scrape_sessions` table tracks runs (like `scraper_jobs`)
- ✅ Library tab shows all articles from DB
- ✅ History tab shows past sessions
- ✅ Scraper saves to DB during run

### Code Example (FIXED)
```typescript
// New article scraper (Server Component + Client)

// page.tsx (Server Component)
export default async function ArticlesPage() {
  const [articles, history, stats] = await Promise.all([
    getArticlesAction(),     // From scraped_articles table
    getScrapeHistoryAction(), // From scrape_sessions table
    getArticleStatsAction()   // Stats from DB
  ]);
  
  return (
    <ArticleScraperClient 
      initialArticles={articles}  // Pass DB data
      initialHistory={history}
    />
  );
}

// ArticleScraperClient.tsx (Client Component)
'use client';

export default function ArticleScraperClient({ initialArticles }) {
  const [articles, setArticles] = useState(initialArticles); // DB data!
  
  // After scrape completes
  const refreshData = async () => {
    const result = await getArticlesAction(); // Fetch from DB
    setArticles(result.data.articles); // Update with DB data
  };
  
  return (
    <Tabs>
      <Tab value="library">
        {articles.map(...)} {/* Shows DB data */}
      </Tab>
    </Tabs>
  );
}
```

---

## Key Differences Summary

| Aspect | Property Scrapers | Article V1 (Broken) | Article V2 (Fixed) |
|--------|------------------|---------------------|-------------------|
| **Component Type** | Server | Client | Server + Client |
| **Data Source** | Database | Memory (SSE) | Database |
| **Persistence** | ✅ Yes | ❌ No | ✅ Yes |
| **Session Tracking** | `scraper_jobs` | ❌ None | `scrape_sessions` |
| **Refresh Behavior** | Shows DB data | Lost | Shows DB data |
| **Pattern** | Fetch → Display | SSE → State | Fetch → Display + SSE |

---

## 🎯 The Fix: 3 Key Changes

### 1. Server Component Pattern
```typescript
// Fetch from DB on page load (like property scrapers)
export default async function ArticlesPage() {
  const articles = await getArticlesAction(); // DB query
  return <Client initialArticles={articles} />;
}
```

### 2. Database Tracking
```typescript
// Create session before scraping
const sessionId = await createScrapeSession();

// Save articles during scrape
await upsertArticles(articles, sessionId);

// Complete session
await completeScrapeSession(sessionId, 'completed');
```

### 3. Tabs for Different Views
```tsx
<Tabs>
  <Tab value="scrape">Live Scraping (SSE)</Tab>
  <Tab value="library">All Articles (DB)</Tab>  
  <Tab value="history">Past Sessions (DB)</Tab>
</Tabs>
```

---

## 💡 Lessons Learned

1. **SSE is for real-time updates, not data persistence**
   - Use SSE for live progress
   - Use database for permanent storage

2. **Match existing patterns in the codebase**
   - Property scrapers use Server Components
   - Article scraper should too

3. **Session tracking is essential**
   - `scraper_jobs` for properties
   - `scrape_sessions` for articles
   - Both serve the same purpose

4. **Database-first approach**
   - Save during scraping
   - Fetch on page load
   - Never rely on memory alone

---

## ✅ Result

Article scraper now works **exactly like property scrapers**:
- ✅ Data persists in database
- ✅ Server Component fetches on load
- ✅ Session tracking
- ✅ History view
- ✅ Library view with search/filter
- ✅ Export functionality
- ✅ Never loses data

The architecture is now **consistent** across all scrapers! 🎉

