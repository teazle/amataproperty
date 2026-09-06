'use client';

/* eslint-disable @next/next/no-img-element -- Admin article previews render arbitrary scraped image hosts. */

import { ExternalLink } from 'lucide-react';
import { cleanArticleParagraphs, extractCleanTextContent } from '@/lib/utils/content-parser';
import { Badge } from '@/components/ui/badge';

export type ArticleImage = string | {
  url?: string;
  src?: string;
  alt?: string;
  caption?: string;
  paragraph_index?: number | null;
};

export interface RenderableArticleContent {
  paragraphs?: string[];
  text_content?: string;
  main_image_url?: string;
  main_image_caption?: string;
  images?: ArticleImage[];
  links?: Array<{
    url: string;
    text?: string;
    type?: string;
  }>;
}

type NormalizedImage = {
  url: string;
  alt: string;
  caption: string;
  paragraphIndex: number | null;
};

function normalizeUrl(url?: string | null) {
  return (url || '').trim().replace(/\/+$/, '');
}

function normalizeImages(images?: ArticleImage[]): NormalizedImage[] {
  if (!Array.isArray(images)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: NormalizedImage[] = [];

  for (const image of images) {
    const url = typeof image === 'string' ? image : image.url || image.src || '';
    const normalizedUrl = normalizeUrl(url);

    if (!normalizedUrl || seen.has(normalizedUrl)) {
      continue;
    }

    seen.add(normalizedUrl);
    normalized.push({
      url: url.trim(),
      alt: typeof image === 'string' ? '' : image.alt || '',
      caption: typeof image === 'string' ? '' : image.caption || '',
      paragraphIndex: typeof image === 'string' ? null : image.paragraph_index ?? null,
    });
  }

  return normalized;
}

function imageMatches(url: string, comparison?: string | null) {
  return Boolean(comparison) && normalizeUrl(url) === normalizeUrl(comparison);
}

function getAutoImageSlot(imageIndex: number, paragraphCount: number) {
  if (paragraphCount <= 2) {
    return paragraphCount - 1;
  }

  if (imageIndex === 0) {
    return Math.min(2, paragraphCount - 1);
  }

  const spacing = Math.max(2, Math.floor(paragraphCount / (imageIndex + 2)));
  return Math.min(paragraphCount - 1, spacing * (imageIndex + 1));
}

function isLikelyRelatedLinksParagraph(paragraph: string, links?: RenderableArticleContent['links']) {
  const lower = paragraph.toLowerCase();
  const matchedLinkTitles = (links || []).filter((link) => {
    const text = (link.text || '').trim();
    return text.length > 18 && lower.includes(text.toLowerCase());
  }).length;

  return matchedLinkTitles >= 2 ||
    lower.includes('weekly e-paper') ||
    lower.includes('read also:') ||
    lower.includes('related articles');
}

function ArticleFigure({ image, title }: { image: NormalizedImage; title: string }) {
  return (
    <figure className="my-8 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <img
        src={image.url}
        alt={image.alt || image.caption || title}
        className="w-full max-h-[520px] object-contain bg-gray-100"
        loading="lazy"
        onError={(event) => {
          (event.target as HTMLImageElement).closest('figure')?.classList.add('hidden');
        }}
      />
      {(image.caption || image.alt) && (
        <figcaption className="border-t border-gray-200 px-4 py-3 text-sm leading-relaxed text-gray-600">
          {image.caption || image.alt}
        </figcaption>
      )}
    </figure>
  );
}

export function ArticleContentRenderer({
  content,
  title,
  heroImageUrl,
  showSourceLinks = false,
}: {
  content: RenderableArticleContent | null;
  title: string;
  heroImageUrl?: string | null;
  showSourceLinks?: boolean;
}) {
  if (!content) {
    return <p className="text-gray-500 italic">Full content not yet scraped</p>;
  }

  const paragraphs = (content.paragraphs?.length
    ? cleanArticleParagraphs(content.paragraphs)
    : content.text_content
      ? extractCleanTextContent(content.text_content)
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
      : [])
    .filter((paragraph) => !isLikelyRelatedLinksParagraph(paragraph, content.links));

  const allImages = normalizeImages(content.images);
  const inlineImages = allImages.filter((image) =>
    !imageMatches(image.url, heroImageUrl) &&
    !imageMatches(image.url, content.main_image_url)
  );

  const explicitImages = new Map<number, NormalizedImage[]>();
  const unindexedImages: NormalizedImage[] = [];

  for (const image of inlineImages) {
    if (
      typeof image.paragraphIndex === 'number' &&
      image.paragraphIndex >= 0 &&
      image.paragraphIndex < Math.max(paragraphs.length, 1)
    ) {
      const imagesAfterParagraph = explicitImages.get(image.paragraphIndex) || [];
      imagesAfterParagraph.push(image);
      explicitImages.set(image.paragraphIndex, imagesAfterParagraph);
    } else {
      unindexedImages.push(image);
    }
  }

  const autoImages = new Map<number, NormalizedImage[]>();
  unindexedImages.forEach((image, index) => {
    const slot = getAutoImageSlot(index, Math.max(paragraphs.length, 1));
    const imagesAfterParagraph = autoImages.get(slot) || [];
    imagesAfterParagraph.push(image);
    autoImages.set(slot, imagesAfterParagraph);
  });

  const renderImagesAfterParagraph = (paragraphIndex: number) => {
    const images = [
      ...(explicitImages.get(paragraphIndex) || []),
      ...(autoImages.get(paragraphIndex) || []),
    ];

    return images.map((image) => (
      <ArticleFigure key={`${paragraphIndex}-${image.url}`} image={image} title={title} />
    ));
  };

  const mainImage = content.main_image_url &&
    !imageMatches(content.main_image_url, heroImageUrl) &&
    !allImages.some((image) => imageMatches(image.url, content.main_image_url))
    ? {
        url: content.main_image_url,
        alt: title,
        caption: content.main_image_caption || '',
        paragraphIndex: null,
      }
    : null;

  const usefulLinks = (content.links || [])
    .filter((link) => link.url && (link.text || link.url).trim().length > 2)
    .filter((link, index, array) => array.findIndex((item) => item.url === link.url) === index)
    .slice(0, 8);

  return (
    <article className="space-y-7 text-[18px] leading-9 text-gray-800">
      {paragraphs.length > 0 ? (
        paragraphs.map((paragraph, index) => (
          <div key={`${index}-${paragraph.slice(0, 24)}`}>
            <p>{paragraph}</p>
            {renderImagesAfterParagraph(index)}
          </div>
        ))
      ) : (
        <p className="text-gray-500 italic">No full content available</p>
      )}

      {mainImage && <ArticleFigure image={mainImage} title={title} />}

      {showSourceLinks && usefulLinks.length > 0 && (
        <aside className="mt-12 border-t border-gray-200 pt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Source Links</h2>
          <ul className="space-y-2 text-sm leading-6">
            {usefulLinks.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-2 text-blue-700 hover:text-blue-900"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{link.text || link.url}</span>
                  {link.type && <Badge variant="outline">{link.type}</Badge>}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </article>
  );
}
