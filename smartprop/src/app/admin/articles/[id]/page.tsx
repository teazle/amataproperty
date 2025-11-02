'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ExternalLink, Clock, FileText, GitCompare } from 'lucide-react';
import { cleanArticleParagraphs, containsHtmlLinks, extractCleanTextContent } from '@/lib/utils/content-parser';

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

export default function ArticleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [article, setArticle] = useState<Article | null>(null);
  const [fullContent, setFullContent] = useState<FullContent | null>(null);
  const [loading, setLoading] = useState(true);

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
          
          <Button 
            variant="outline"
            onClick={() => router.push(`/admin/articles/${params.id}/compare`)}
          >
            <GitCompare className="w-4 h-4 mr-2" />
            Compare with Original
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

          {article.thumbnail && (
            <img 
              src={article.thumbnail}
              alt={article.title}
              className="w-full h-64 object-cover rounded-lg mb-6"
            />
          )}

          {fullContent ? (
            <div className="prose max-w-none">
              {fullContent.paragraphs && fullContent.paragraphs.length > 0 ? (
                (() => {
                  const cleanedParagraphs = cleanArticleParagraphs(fullContent.paragraphs);
                  const images = Array.isArray(fullContent.images) ? fullContent.images : [];
                  
                  // Group images by paragraph_index
                  const imagesByParaIndex: Record<number, any[]> = {};
                  images.forEach((img: any) => {
                    const paraIdx = img.paragraph_index;
                    if (paraIdx !== undefined && paraIdx >= 0) {
                      if (!imagesByParaIndex[paraIdx]) {
                        imagesByParaIndex[paraIdx] = [];
                      }
                      imagesByParaIndex[paraIdx].push(img);
                    }
                  });
                  
                  return cleanedParagraphs.map((para: string, idx: number) => {
                  // Check if paragraph contains HTML links
                  const hasLinks = containsHtmlLinks(para);
                    
                    const paraElement = hasLinks ? (
                      <div 
                        key={`para-${idx}`} 
                        className="mb-4 text-gray-700 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: para }}
                      />
                    ) : (
                      <p key={`para-${idx}`} className="mb-4 text-gray-700 leading-relaxed">
                        {para}
                      </p>
                    );
                    
                    // Check if there are images that should appear after this paragraph
                    const imagesAfterThisPara = imagesByParaIndex[idx] || [];
                    
                    return (
                      <div key={idx}>
                        {paraElement}
                        {imagesAfterThisPara.map((img: any, imgIdx: number) => {
                          const imgUrl = typeof img === 'string' ? img : img.url || img.src;
                          const imgAlt = typeof img === 'string' ? '' : (img.alt || '');
                          const imgCaption = typeof img === 'string' ? '' : (img.caption || '');
                          
                          if (!imgUrl) return null;
                          
                          return (
                            <figure key={`img-${idx}-${imgIdx}`} className="my-6 space-y-2">
                              <img 
                                src={imgUrl}
                                alt={imgAlt || `Image ${imgIdx + 1}`}
                                className="w-full h-auto rounded-lg border"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                              {(imgCaption || (imgAlt && !imgCaption)) && (
                                <figcaption className="text-sm text-gray-600 italic text-center">
                                  {imgCaption || imgAlt}
                                </figcaption>
                              )}
                            </figure>
                          );
                        })}
                      </div>
                    );
                  });
                })()
              ) : fullContent.text_content ? (
                <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                  {extractCleanTextContent(fullContent.text_content)}
                </div>
              ) : (
                <p className="text-gray-500 italic">No full content available</p>
              )}

              {/* Display images that don't have a paragraph_index (fallback for older scrapes) */}
              {fullContent.images && Array.isArray(fullContent.images) && 
               fullContent.images.some((img: any) => img.paragraph_index === undefined || img.paragraph_index === null) && (
                <div className="mt-8 pt-8 border-t">
                  <h3 className="text-xl font-semibold mb-4">Additional Images</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {fullContent.images
                      .filter((img: any) => img.paragraph_index === undefined || img.paragraph_index === null)
                      .map((img: any, idx: number) => {
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
                          </figure>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Display main image if different from thumbnail */}
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

              {fullContent.links && fullContent.links.length > 0 && (
                <div className="mt-8 pt-8 border-t">
                  <h3 className="text-xl font-semibold mb-4">References & Links</h3>
                  <ul className="space-y-2">
                    {fullContent.links.slice(0, 10).map((link, idx: number) => (
                      <li key={idx}>
                        <a 
                          href={link.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {link.text || link.url}
                          <Badge variant="outline" className="ml-2">{link.type}</Badge>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 italic">Full content not yet scraped</p>
          )}
        </div>
      </div>
    </div>
  );
}
