/**
 * Export articles as JSON or CSV
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const format = searchParams.get('format') || 'json';
  const articles = searchParams.get('articles');
  
  if (!articles) {
    return NextResponse.json({ error: 'No articles provided' }, { status: 400 });
  }
  
  try {
    const parsedArticles = JSON.parse(decodeURIComponent(articles));
    
    if (format === 'csv') {
      // Generate CSV
      const headers = ['title', 'category', 'author', 'created_on', 'url', 'thumbnail', 'description'];
      const csvRows = [headers.join(',')];
      
      parsedArticles.forEach((article: unknown) => {
        const articleObj = article as Record<string, unknown>;
        const values = headers.map(header => {
          let value = articleObj[header];
          if (header === 'url') {
            value = `https://www.edgeprop.sg/${articleObj.path}`;
          }
          if (Array.isArray(value)) {
            value = value.join(';');
          }
          const stringValue: string = value === null || value === undefined ? '' : String(value);
          // Escape CSV
          if (stringValue.includes(',') || stringValue.includes('"')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        });
        csvRows.push(values.join(','));
      });
      
      const csv = csvRows.join('\n');
      
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="edgeprop-articles-${Date.now()}.csv"`,
        },
      });
    } else {
      // JSON export
      const json = JSON.stringify({
        metadata: {
          source: 'EdgeProp Singapore',
          url: 'https://www.edgeprop.sg/property-news-search',
          totalArticles: parsedArticles.length,
          exportedAt: new Date().toISOString()
        },
        articles: parsedArticles
      }, null, 2);
      
      return new Response(json, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="edgeprop-articles-${Date.now()}.json"`,
        },
      });
    }
  } catch (error: any) {
    console.error('Error exporting articles:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

