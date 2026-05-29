import { NextRequest } from 'next/server';
import fs from 'fs';

const LOG_FILE_PATH = '/tmp/linkedin-automation.log';

/**
 * SSE endpoint for streaming LinkedIn automation logs in real-time
 * GET /api/linkedin/logs/stream
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;
      let lastPosition = 0;
      let lastSize = 0;
      
      // Helper to safely send data
      const sendData = (data: string) => {
        if (!isClosed) {
          try {
            controller.enqueue(encoder.encode(data));
          } catch (error) {
            if (error instanceof Error && (error.message.includes('closed') || error.name === 'InvalidStateError')) {
              isClosed = true;
            }
          }
        }
      };

      // Send initial connection message
      sendData(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to log stream' })}\n\n`);

      // Check if file exists, if not, create it
      if (!fs.existsSync(LOG_FILE_PATH)) {
        try {
          fs.writeFileSync(LOG_FILE_PATH, '');
        } catch (error) {
          sendData(`data: ${JSON.stringify({ type: 'error', message: 'Failed to create log file' })}\n\n`);
          controller.close();
          return;
        }
      }

      // Read existing content first (last 500 lines)
      try {
        const existingContent = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
        const lines = existingContent.split('\n').filter(line => line.trim());
        const recentLines = lines.slice(-500); // Last 500 lines
        
        if (recentLines.length > 0) {
          // Send existing logs
          for (const line of recentLines) {
            sendData(`data: ${JSON.stringify({ type: 'log', line })}\n\n`);
          }
          sendData(`data: ${JSON.stringify({ type: 'info', message: `Loaded ${recentLines.length} existing log lines` })}\n\n`);
        }
        
        // Set initial position to end of file
        const stats = fs.statSync(LOG_FILE_PATH);
        lastPosition = stats.size;
        lastSize = stats.size;
      } catch (error) {
        sendData(`data: ${JSON.stringify({ type: 'error', message: `Failed to read log file: ${(error instanceof Error ? error.message : String(error))}` })}\n\n`);
      }

      // Watch for file changes and stream new content
      const watchInterval = setInterval(() => {
        if (isClosed) {
          clearInterval(watchInterval);
          return;
        }

        try {
          if (!fs.existsSync(LOG_FILE_PATH)) {
            return;
          }

          const stats = fs.statSync(LOG_FILE_PATH);
          
          // If file size decreased (file was truncated/reset), reset position
          if (stats.size < lastSize) {
            lastPosition = 0;
            lastSize = stats.size;
            sendData(`data: ${JSON.stringify({ type: 'info', message: 'Log file was reset' })}\n\n`);
            return;
          }

          // If file grew, read new content
          if (stats.size > lastPosition) {
            const fileHandle = fs.openSync(LOG_FILE_PATH, 'r');
            const buffer = Buffer.alloc(stats.size - lastPosition);
            fs.readSync(fileHandle, buffer, 0, buffer.length, lastPosition);
            fs.closeSync(fileHandle);
            
            const newContent = buffer.toString('utf-8');
            const newLines = newContent.split('\n').filter(line => line.trim().length > 0);
            
            for (const line of newLines) {
              sendData(`data: ${JSON.stringify({ type: 'log', line })}\n\n`);
            }
            
            lastPosition = stats.size;
            lastSize = stats.size;
          }
        } catch (error) {
          if (!isClosed) {
            sendData(`data: ${JSON.stringify({ type: 'error', message: `Error reading log file: ${(error instanceof Error ? error.message : String(error))}` })}\n\n`);
          }
        }
      }, 500); // Check every 500ms for near real-time updates

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeatInterval = setInterval(() => {
        if (!isClosed) {
          sendData(`: heartbeat\n\n`);
        } else {
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        isClosed = true;
        clearInterval(watchInterval);
        clearInterval(heartbeatInterval);
        try {
          controller.close();
        } catch (error) {
          // Ignore errors on close
        }
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
