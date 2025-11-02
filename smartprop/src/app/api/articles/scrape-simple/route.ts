/**
 * Simple SSE endpoint for testing without scraper
 */

import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const maxPages = parseInt(searchParams.get('pages') || '10');
  
  console.log('Simple SSE endpoint called with pages:', maxPages);
  
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      console.log('Starting simple SSE stream');
      
      // Send immediate messages
      const messages = [
        { message: 'Simple SSE test 1', timestamp: new Date().toISOString() },
        { message: 'Simple SSE test 2', timestamp: new Date().toISOString() },
        { message: 'Simple SSE test 3', timestamp: new Date().toISOString() }
      ];
      
      messages.forEach((msg, index) => {
        setTimeout(() => {
          const data = `data: ${JSON.stringify(msg)}\n\n`;
          controller.enqueue(encoder.encode(data));
          
          if (index === messages.length - 1) {
            controller.close();
          }
        }, index * 1000);
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Cache-Control',
    },
  });
}
