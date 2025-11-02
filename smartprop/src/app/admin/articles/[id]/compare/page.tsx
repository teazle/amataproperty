'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ExternalLink, Clock, FileText, Eye, EyeOff } from 'lucide-react';

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

interface FullContent {
  paragraphs?: string[];
  text_content?: string;
  reading_time_minutes?: number;
  word_count?: number;
  main_image_url?: string;
  main_image_caption?: string;
  images?: Array<{
    url?: string;
    src?: string;
    alt?: string;
    caption?: string;
    paragraph_index?: number;
  }>;
  links?: Array<{
    url: string;
    text?: string;
    type?: string;
  }>;
}

export default function ArticleComparePage() {
  const params = useParams();
  const router = useRouter();
  const [article, setArticle] = useState<Article | null>(null);
  const [fullContent, setFullContent] = useState<FullContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOriginal, setShowOriginal] = useState(true);

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

  useEffect(() => {
    fetchArticleDetail();
  }, [params.id]);

  if (loading) return <div className="p-8">Loading...</div>;
  if (!article) return <div className="p-8">Article not found</div>;

  const originalUrl = `https://www.edgeprop.sg${article.path?.toString().startsWith('/') ? '' : '/'}${article.path}`;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              onClick={() => router.back()}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <h1 className="text-xl font-semibold">Article Comparison</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant={showOriginal ? "default" : "outline"}
              size="sm"
              onClick={() => setShowOriginal(!showOriginal)}
            >
              {showOriginal ? <Eye className="w-4 h-4 mr-2" /> : <EyeOff className="w-4 h-4 mr-2" />}
              {showOriginal ? 'Hide' : 'Show'} Original
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex h-[calc(100vh-80px)]">
        {/* Original Article */}
        {showOriginal && (
          <div className="w-1/2 border-r">
            <div className="bg-blue-50 p-3 border-b">
              <h2 className="font-semibold text-blue-900 flex items-center gap-2">
                <ExternalLink className="w-4 h-4" />
                Original Article
              </h2>
              <p className="text-sm text-blue-700 truncate">{originalUrl}</p>
            </div>
            <iframe
              src={originalUrl}
              className="w-full h-full"
              title="Original Article"
            />
          </div>
        )}

        {/* Scraped Article */}
        <div className={showOriginal ? "w-1/2" : "w-full"}>
          <div className="bg-green-50 p-3 border-b">
            <h2 className="font-semibold text-green-900 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Scraped Article
            </h2>
            <div className="text-sm text-green-700 flex items-center gap-4">
              <span>NID: {params.id}</span>
              {fullContent && (
                <>
                  <span>•</span>
                  <span>{fullContent.word_count} words</span>
                  <span>•</span>
                  <span>{fullContent.reading_time_minutes} min read</span>
                  <span>•</span>
                  <span>{fullContent.images?.length || 0} images</span>
                </>
              )}
            </div>
          </div>
          
          <div className="h-full overflow-y-auto p-6 bg-white">
            {/* Article Header */}
            <div className="mb-6">
              <h1 className="text-3xl font-bold text-gray-900 mb-4">
                {article.title}
              </h1>
              
              <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                <span>By {article.author || 'Unknown'}</span>
                <span>•</span>
                <span>{article.created ? new Date(article.created).toLocaleDateString() : 'Unknown date'}</span>
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
            </div>

            {/* Thumbnail */}
            {article.thumbnail && (
              <img 
                src={article.thumbnail}
                alt={article.title}
                className="w-full h-64 object-cover rounded-lg mb-6"
              />
            )}

            {/* Content */}
            {fullContent ? (
              <div className="prose max-w-none">
                {fullContent.paragraphs && fullContent.paragraphs.length > 0 ? (
                  fullContent.paragraphs.map((para: string, idx: number) => (
                    <p key={idx} className="mb-4 text-gray-700 leading-relaxed">
                      {para}
                    </p>
                  ))
                ) : fullContent.text_content ? (
                  <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                    {fullContent.text_content}
                  </div>
                ) : (
                  <p className="text-gray-500 italic">No content available</p>
                )}

                {/* Images Section - This is where the issue is! */}
                {fullContent.images && fullContent.images.length > 0 && (
                  <div className="mt-8 pt-8 border-t">
                    <h3 className="text-xl font-semibold mb-4 text-red-600">
                      ⚠️ Images (Currently displayed at bottom - Issue to fix!)
                    </h3>
                    <div className="bg-red-50 p-4 rounded-lg mb-4">
                      <p className="text-red-700 text-sm">
                        <strong>Issue:</strong> Images are being displayed here at the bottom instead of inline with the content like in the original article.
                        This is the problem that needs to be fixed in the scraper or display logic.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {fullContent.images.map((img: any, idx: number) => {
                        const imgUrl = typeof img === 'string' ? img : img.url || img.src;
                        const imgAlt = typeof img === 'string' ? '' : (img.alt || '');
                        const imgCaption = typeof img === 'string' ? '' : (img.caption || '');
                        
                        if (!imgUrl) return null;
                        
                        return (
                          <figure key={idx} className="space-y-2">
                            <img 
                              src={imgUrl}
                              alt={imgAlt || `Image ${idx + 1}`}
                              className="w-full h-auto rounded-lg border"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                            {imgCaption && (
                              <figcaption className="text-sm text-gray-600 italic text-center">
                                {imgCaption}
                              </figcaption>
                            )}
                            {imgAlt && !imgCaption && (
                              <figcaption className="text-sm text-gray-600 italic text-center">
                                {imgAlt}
                              </figcaption>
                            )}
                            <div className="text-xs text-gray-500 bg-gray-100 p-2 rounded">
                              <strong>Debug Info:</strong><br/>
                              URL: {imgUrl}<br/>
                              Paragraph Index: {typeof img === 'object' ? img.paragraph_index : 'N/A'}<br/>
                              Type: {typeof img}
                            </div>
                          </figure>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Main Image */}
                {fullContent.main_image_url && fullContent.main_image_url !== article.thumbnail && (
                  <div className="mt-8 pt-8 border-t">
                    <h3 className="text-xl font-semibold mb-4">Main Image</h3>
                    <figure className="space-y-2">
                      <img 
                        src={fullContent.main_image_url}
                        alt={fullContent.main_image_caption || article.title}
                        className="w-full h-auto rounded-lg border"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      {fullContent.main_image_caption && (
                        <figcaption className="text-sm text-gray-600 italic text-center">
                          {fullContent.main_image_caption}
                        </figcaption>
                      )}
                    </figure>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 italic">Full content not yet scraped</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}