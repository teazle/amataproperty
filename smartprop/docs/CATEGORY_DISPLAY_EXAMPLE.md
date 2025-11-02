# Category Display Example for Article Library

Based on your screenshot, here's how to display the scraped categories as small, rounded tags in your article library:

## CSS Example

```css
/* Category Tags */
.category-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.category-tag {
  display: inline-block;
  background-color: #f5f5f5; /* Light grey background */
  color: #666; /* Dark grey text */
  padding: 4px 8px;
  border-radius: 12px; /* Rounded corners */
  font-size: 0.75rem; /* Small font size */
  font-weight: 500;
  white-space: nowrap;
  text-transform: capitalize;
}

/* Discovery Method Tag */
.discovery-method-tag {
  display: inline-block;
  background-color: #e3f2fd; /* Light blue background */
  color: #1976d2; /* Blue text */
  padding: 2px 6px;
  border-radius: 8px;
  font-size: 0.7rem;
  font-weight: 600;
  margin-left: 8px;
}

/* Article Card Layout */
.article-card {
  display: flex;
  gap: 16px;
  padding: 16px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin-bottom: 16px;
}

.article-thumbnail {
  width: 120px;
  height: 80px;
  object-fit: cover;
  border-radius: 4px;
}

.article-content {
  flex: 1;
}

.article-meta {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.8rem;
  color: #666;
}

.article-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 8px;
  line-height: 1.4;
}

.article-description {
  font-size: 0.9rem;
  color: #666;
  line-height: 1.4;
  margin-bottom: 12px;
}

.article-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.author-date {
  font-size: 0.8rem;
  color: #888;
}

.view-link {
  background-color: #007bff;
  color: white;
  padding: 6px 12px;
  border-radius: 4px;
  text-decoration: none;
  font-size: 0.8rem;
  font-weight: 500;
}
```

## HTML Example

```html
<div class="article-card">
  <img src="article.thumbnail" alt="Article Thumbnail" class="article-thumbnail" />
  
  <div class="article-content">
    <!-- Categories -->
    <div class="category-tags">
      <span class="category-tag">News</span>
      <span class="category-tag">International</span>
      <span class="discovery-method-tag">API</span>
    </div>
    
    <!-- Author and Date -->
    <div class="article-meta">
      <span class="author-date">Ashley Lo and Kalynskye Adrian - 10/15/2025</span>
    </div>
    
    <!-- Title -->
    <h3 class="article-title">IOI Properties kicks off public launch of W Residences Marina View...</h3>
    
    <!-- Description -->
    <p class="article-description">The October exercise brings the total number of SWT flats launched in 2025 to 4,690 units, surpassing...</p>
    
    <!-- Footer -->
    <div class="article-footer">
      <span class="reading-time">4 min read</span>
      <a href="/article/6004719" class="view-link">View</a>
    </div>
  </div>
</div>
```

## React/Next.js Component Example

```tsx
interface Article {
  nid: string;
  title: string;
  author: string;
  category: string[];
  description: string;
  discovery_method: 'api' | 'dom' | 'unknown';
  thumbnail: string;
  created: string;
  word_count: number;
  reading_time_minutes: number;
}

export function ArticleCard({ article }: { article: Article }) {
  const formatDate = (dateStr: string) => {
    // Extract date from "By Author / EdgeProp Singapore | October 15, 2025 5:54 PM SGT"
    const dateMatch = dateStr.match(/(\w+ \d+, \d+)/);
    return dateMatch ? dateMatch[1] : dateStr;
  };

  return (
    <div className="article-card">
      <img 
        src={article.thumbnail} 
        alt="Article Thumbnail" 
        className="article-thumbnail" 
      />
      
      <div className="article-content">
        {/* Categories */}
        <div className="category-tags">
          {article.category.slice(0, 2).map((cat, index) => (
            <span key={index} className="category-tag">
              {cat}
            </span>
          ))}
          <span className="discovery-method-tag">
            {article.discovery_method.toUpperCase()}
          </span>
        </div>
        
        {/* Author and Date */}
        <div className="article-meta">
          <span className="author-date">
            {article.author} - {formatDate(article.created)}
          </span>
        </div>
        
        {/* Title */}
        <h3 className="article-title">{article.title}</h3>
        
        {/* Description */}
        <p className="article-description">
          {article.description?.substring(0, 150)}...
        </p>
        
        {/* Footer */}
        <div className="article-footer">
          <span className="reading-time">
            {article.reading_time_minutes} min read
          </span>
          <a href={`/article/${article.nid}`} className="view-link">
            View
          </a>
        </div>
      </div>
    </div>
  );
}
```

## Key Features

1. **Small, Rounded Tags**: Categories display as small, grey, rounded badges
2. **Discovery Method**: Shows "API" or "DOM" in a blue badge
3. **Clean Layout**: Matches your screenshot's clean, card-based design
4. **Responsive**: Flexbox layout that works on different screen sizes
5. **Limited Categories**: Shows max 2 categories to avoid clutter

## Data Structure

Your scraper now provides:
- `discovery_method`: 'api' | 'dom' | 'unknown'
- `category`: Array of cleaned category strings
- `author`: Properly extracted author names
- All other metadata (title, description, word count, etc.)

This matches the format shown in your screenshot perfectly! 🎯
