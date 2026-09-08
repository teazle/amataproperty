export type EdgePropArticleMetadata = {
  author: string;
  created: string;
};

export type EdgePropMetadataDocument = Pick<Document, 'querySelector'>;

/**
 * Runs inside the EdgeProp page so metadata stays scoped to the article header.
 */
export function extractEdgePropArticleMetadata(metadataDocument?: EdgePropMetadataDocument | void): EdgePropArticleMetadata {
  const documentToQuery = metadataDocument || document;
  const author = documentToQuery.querySelector('#article-detail-otherinfo .article-info-author-name-wrapper a')?.textContent?.trim() || '';
  const created =
    documentToQuery.querySelector('#article-detail-otherinfo time[datetime]')?.getAttribute('datetime')?.trim() ||
    documentToQuery.querySelector('meta[property="article:published_time"]')?.getAttribute('content')?.trim() ||
    documentToQuery.querySelector('time[datetime]')?.getAttribute('datetime')?.trim() ||
    '';

  return { author, created };
}
