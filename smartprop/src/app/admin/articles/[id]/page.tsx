'use client';

/* eslint-disable @next/next/no-img-element -- Admin article previews render arbitrary scraped image hosts. */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ExternalLink, Clock, FileText } from 'lucide-react';
import { ArticleBodyRenderer } from '../ArticleBodyRenderer';

interface Article {
  id: string;
  title: string;
  url: string;
  thumbnail?: string;
  published_at?: string;
  source?: string;
  category?: string;
  author?: string;
  created?: string;
  path?: string;
}

type ArticleImage = string | {
  url?: string;
  src?: string;
  alt?: string;
  caption?: string;
  paragraph_index?: number | null;
};

interface FullContent {
  html_content?: string | null;
  paragraphs?: string[];
  text_content?: string;
  reading_time_minutes?: number;
  word_count?: number;
  main_image_url?: string;
  main_image_caption?: string;
  images?: ArticleImage[];
  links?: Array<{
    url: string;
    text?: string;
    type?: string;
  }>;
}

function formatArticleDate(value?: string) {
  if (!value) return 'Unknown date';

  const numericValue = Number(value);
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue)
    : new Date(value);

  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleDateString();
}

export default function ArticleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [article, setArticle] = useState<Article | null>(null);
  const [fullContent, setFullContent] = useState<FullContent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchArticleDetail = async () => {
      try {
        const response = await fetch(`/api/articles/${params.id}`);
        const data = await response.json();
        setArticle(data.article);
        setFullContent(data.fullContent);
      } catch (error) {
        console.error('Failed to fetch article:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchArticleDetail();
  }, [params.id]);

  if (loading) return <div className="p-8">Loading...</div>;
  if (!article) return <div className="p-8">Article not found</div>;

  // Check if thumbnail is same as first image to avoid duplication
  const images = Array.isArray(fullContent?.images) ? fullContent.images : [];
  const firstImages = images.filter((img) => typeof img !== 'string' && img.paragraph_index === 0);
  const thumbnailIsFirstImage = article.thumbnail && firstImages.some((img) => {
    const imgUrl = typeof img === 'string' ? img : img.url || img.src;
    return imgUrl === article.thumbnail;
  });

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <Button 
            variant="ghost" 
            onClick={() => router.back()}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Articles
          </Button>
        </div>

        <div className="bg-white rounded-lg shadow p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              {article.title}
            </h1>
            
            <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
              <span>By {article.author || 'Unknown'}</span>
              <span>•</span>
              <span>{formatArticleDate(article.created)}</span>
              {fullContent && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {fullContent.reading_time_minutes} min read
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <FileText className="w-4 h-4" />
                    {fullContent.word_count} words
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {(Array.isArray(article.category) ? article.category : [article.category]).map((cat, idx) => (
                <Badge key={idx} variant="secondary">{cat}</Badge>
              ))}
            </div>

            <a 
              href={`https://www.edgeprop.sg${article.path?.toString().startsWith('/') ? '' : '/'}${article.path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <ExternalLink className="w-4 h-4" />
              View Original Article
            </a>
          </div>

          {article.thumbnail && !thumbnailIsFirstImage && (
            <img 
              src={article.thumbnail}
              alt={article.title}
              className="w-full h-64 object-cover rounded-lg mb-6"
            />
          )}

          {fullContent ? (
            <ArticleBodyRenderer content={fullContent} />
          ) : (
            <p className="text-gray-500 italic">Full content not yet scraped</p>
          )}
        </div>
      </div>
    </div>
  );
}
