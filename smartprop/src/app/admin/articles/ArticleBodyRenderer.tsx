'use client';

/* eslint-disable @next/next/no-img-element -- Article bodies contain scraped remote media. */

import { prepareArticleHtmlForDisplay, cleanArticleParagraphs, extractCleanTextContent } from '@/lib/utils/content-parser';

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
  const savedParagraphs = cleanArticleParagraphs(content.paragraphs || []);
  // The legacy formatter is not a sanitizer. Never insert scraped markup as HTML.
  const htmlParagraphs = prepareArticleHtmlForDisplay(content.html_content || '')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .split('\n')
    .map(extractCleanTextContent)
    .filter(Boolean);
  const cleanedParagraphs = savedParagraphs.length ? savedParagraphs : htmlParagraphs;
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
          return (
            <div key={idx}>
              <p>{extractCleanTextContent(paragraph)}</p>

              {(imagesByParaIndex[idx] || []).map((img, imgIdx) => {
                const imgUrl = typeof img === 'string' ? img : img.url || img.src;
                const imgAlt = typeof img === 'string' ? '' : img.alt || '';
                const imgCaption = typeof img === 'string' ? '' : img.caption || '';

                if (!imgUrl) return null;
                try {
                  const protocol = new URL(imgUrl, 'https://article.invalid').protocol;
                  if (protocol !== 'https:' && protocol !== 'http:') return null;
                } catch {
                  return null;
                }

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
