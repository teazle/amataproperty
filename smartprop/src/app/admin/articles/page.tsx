import { Suspense } from 'react';
import { getArticlesAction, getScrapeHistoryAction, getArticleStatsAction } from './actions';
import ArticleScraperClient from './ArticleScraperClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ArticlesPage() {
  // Fetch initial data from database (Server Component pattern like property scrapers)
  const [articlesResult, historyResult, statsResult] = await Promise.all([
    getArticlesAction(1),
    getScrapeHistoryAction(),
    getArticleStatsAction()
  ]);

  const articles = articlesResult.success && articlesResult.data ? articlesResult.data : { articles: [], total: 0, pages: 0 };
  const history = historyResult.success && historyResult.data ? historyResult.data : [];
  const stats = statsResult.success && statsResult.data ? statsResult.data : { totalArticles: 0, totalSessions: 0 };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">📰 Article Scraper</h1>
          <p className="text-gray-700 mt-1">
            Scrape and manage EdgeProp Singapore news articles
          </p>
        </div>
        
        {/* Stats Badge */}
        <div className="flex gap-4 text-sm">
          <div className="bg-blue-50 px-4 py-2 rounded-lg">
            <span className="text-gray-600">Total Articles:</span>
            <span className="font-bold text-blue-600 ml-2">{stats.totalArticles}</span>
          </div>
          <div className="bg-green-50 px-4 py-2 rounded-lg">
            <span className="text-gray-600">Scrape Sessions:</span>
            <span className="font-bold text-green-600 ml-2">{stats.totalSessions}</span>
          </div>
        </div>
      </div>

      <Suspense fallback={<div>Loading...</div>}>
        <ArticleScraperClient
          initialArticles={articles.articles}
          initialTotal={articles.total}
          initialPages={articles.pages}
          initialHistory={history}
          initialStats={stats}
        />
      </Suspense>
    </div>
  );
}
