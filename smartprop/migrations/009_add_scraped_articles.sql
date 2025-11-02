-- Scrape Sessions Table
CREATE TABLE IF NOT EXISTS scrape_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(100) NOT NULL DEFAULT 'EdgeProp',
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) NOT NULL DEFAULT 'running', -- running, completed, stopped, error
  pages_scraped INTEGER DEFAULT 0,
  articles_scraped INTEGER DEFAULT 0,
  unique_articles INTEGER DEFAULT 0,
  duplicates_found INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Scraped Articles Table
CREATE TABLE IF NOT EXISTS scraped_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nid VARCHAR(50) NOT NULL UNIQUE, -- EdgeProp article ID
  title TEXT NOT NULL,
  thumbnail TEXT,
  path TEXT NOT NULL,
  author VARCHAR(255),
  created VARCHAR(50), -- Unix timestamp from EdgeProp
  category JSONB, -- Can be string or array
  description TEXT,
  created_on VARCHAR(100), -- Human readable date
  keywords JSONB,
  source VARCHAR(100) NOT NULL DEFAULT 'EdgeProp',
  first_scraped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_scraped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  scrape_count INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Junction table for many-to-many relationship
CREATE TABLE IF NOT EXISTS scrape_session_articles (
  session_id UUID NOT NULL REFERENCES scrape_sessions(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES scraped_articles(id) ON DELETE CASCADE,
  was_new BOOLEAN DEFAULT TRUE, -- Was this article new in this session?
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, article_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_scrape_sessions_started_at ON scrape_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_sessions_status ON scrape_sessions(status);
CREATE INDEX IF NOT EXISTS idx_scraped_articles_nid ON scraped_articles(nid);
CREATE INDEX IF NOT EXISTS idx_scraped_articles_first_scraped ON scraped_articles(first_scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraped_articles_title ON scraped_articles USING gin(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_scraped_articles_category ON scraped_articles USING gin(category);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER update_scrape_sessions_updated_at BEFORE UPDATE ON scrape_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scraped_articles_updated_at BEFORE UPDATE ON scraped_articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE scrape_sessions IS 'Tracks each scraping session with metadata';
COMMENT ON TABLE scraped_articles IS 'Stores all unique scraped articles';
COMMENT ON TABLE scrape_session_articles IS 'Links articles to scraping sessions';
COMMENT ON COLUMN scraped_articles.nid IS 'EdgeProp unique article identifier';
COMMENT ON COLUMN scraped_articles.scrape_count IS 'Number of times this article was encountered';

