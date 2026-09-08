export type EdgePropArticleMetadata = {
  author: string;
  created: string;
};

/**
 * Runs inside the EdgeProp page so metadata stays scoped to the article header.
 */
export function extractEdgePropArticleMetadata(): EdgePropArticleMetadata {
  const author = document.querySelector('#article-detail-otherinfo .article-info-author-name-wrapper a')?.textContent?.trim() || '';
  const created =
    document.querySelector('#article-detail-otherinfo time[datetime]')?.getAttribute('datetime')?.trim() ||
    document.querySelector('meta[property="article:published_time"]')?.getAttribute('content')?.trim() ||
    document.querySelector('time[datetime]')?.getAttribute('datetime')?.trim() ||
    '';

  return { author, created };
}
