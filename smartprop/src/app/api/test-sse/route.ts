export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send immediate test message
      const data = `data: ${JSON.stringify({
        message: 'Test SSE connection',
        timestamp: new Date().toISOString()
      })}\n\n`;
      controller.enqueue(encoder.encode(data));
      
      // Send another message after 1 second
      setTimeout(() => {
        const data2 = `data: ${JSON.stringify({
          message: 'Second test message',
          timestamp: new Date().toISOString()
        })}\n\n`;
        controller.enqueue(encoder.encode(data2));
        controller.close();
      }, 1000);
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
