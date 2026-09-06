'use client';

/* eslint-disable @next/next/no-img-element -- Article bodies contain scraped remote media. */

import { prepareArticleHtmlForDisplay, cleanArticleParagraphs, containsHtmlLinks, extractCleanTextContent } from '@/lib/utils/content-parser';

type ArticleImage = string | {
  url?: string;
  src?: string;
  alt?: string;
  caption?: string;
  paragraph_index?: number | null;
};

export interface ArticleBodyContent {
  html_content?: string | null;
  paragraphs?: string[];
  text_content?: string;
  images?: ArticleImage[];
}

type ArticleBodyRendererProps = {
  content: ArticleBodyContent;
};

export function ArticleBodyRenderer({ content }: ArticleBodyRendererProps) {
  const articleHtml = prepareArticleHtmlForDisplay(content.html_content || '');

  if (articleHtml) {
    return (
      <article
        className="edgeprop-article-body"
        dangerouslySetInnerHTML={{ __html: articleHtml }}
      />
    );
  }

  const cleanedParagraphs = cleanArticleParagraphs(content.paragraphs || []);
  const images = Array.isArray(content.images) ? content.images : [];
  const imagesByParaIndex: Record<number, ArticleImage[]> = {};

  images.forEach((img) => {
    const paraIdx = typeof img === 'string' ? undefined : img.paragraph_index;
    if (paraIdx !== undefined && paraIdx !== null && paraIdx >= 0) {
      imagesByParaIndex[paraIdx] ||= [];
      imagesByParaIndex[paraIdx].push(img);
    }
  });

  if (cleanedParagraphs.length > 0) {
    return (
      <article className="edgeprop-article-body">
        {cleanedParagraphs.map((paragraph, idx) => {
          const hasLinks = containsHtmlLinks(paragraph);

          return (
            <div key={idx}>
              {hasLinks ? (
                <div dangerouslySetInnerHTML={{ __html: paragraph }} />
              ) : (
                <p>{paragraph}</p>
              )}

              {(imagesByParaIndex[idx] || []).map((img, imgIdx) => {
                const imgUrl = typeof img === 'string' ? img : img.url || img.src;
                const imgAlt = typeof img === 'string' ? '' : img.alt || '';
                const imgCaption = typeof img === 'string' ? '' : img.caption || '';

                if (!imgUrl) return null;

                return (
                  <figure key={`${idx}-${imgIdx}`}>
                    <img src={imgUrl} alt={imgAlt || `Article image ${imgIdx + 1}`} />
                    {(imgCaption || imgAlt) && (
                      <figcaption>{imgCaption || imgAlt}</figcaption>
                    )}
                  </figure>
                );
              })}
            </div>
          );
        })}
      </article>
    );
  }

  if (content.text_content) {
    return (
      <article className="edgeprop-article-body whitespace-pre-wrap">
        {extractCleanTextContent(content.text_content)}
      </article>
    );
  }

  return <p className="text-gray-500 italic">No content available</p>;
}
