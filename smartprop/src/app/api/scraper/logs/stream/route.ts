import fs from 'fs';
import { NextRequest } from 'next/server';
import path from 'path';

/**
 * Server-Sent Events endpoint for real-time scraper log streaming
 * 
 * Usage from client:
 *   const eventSource = new EventSource('/api/scraper/logs/stream?platform=edgeprop');
 *   eventSource.onmessage = (event) => {
 *     const data = JSON.parse(event.data);
 *     // Update logs UI
 *   };
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const searchParams = request.nextUrl.searchParams;
  const platform = searchParams.get('platform') || 'edgeprop';

  const stream = new ReadableStream({
    async start(controller) {
      let lastFileSize = 0;
      let lastLogFile: string | null = null;
      let lastLines: string[] = [];

      const sendLogs = async () => {
        try {
          // Find the latest log file for the platform
          const logDir = '/tmp';
          const _logPattern = platform === 'edgeprop' ? 'ep-scraper-*.log' : 'pg-scraper-*.log';
          
          // Get all matching log files
          const logFiles = fs.readdirSync(logDir)
            .filter(file => file.match(platform === 'edgeprop' ? /^ep-scraper-.*\.log$/ : /^pg-scraper-.*\.log$/))
            .map(file => ({
              name: file,
              path: path.join(logDir, file),
              mtime: fs.statSync(path.join(logDir, file)).mtime
            }))
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

          if (logFiles.length === 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: 'error', 
              message: `No log files found for platform: ${platform}` 
            })}\n\n`));
            return;
          }

          const latestLogFile = logFiles[0];
          const currentLogFile = latestLogFile.path;
          const fileStats = fs.statSync(currentLogFile);

          // If log file changed (new file created), reset tracking
          if (lastLogFile !== currentLogFile) {
            lastLogFile = currentLogFile;
            lastFileSize = 0;
            lastLines = [];
          }

          // If this is the first time or file changed, send initial content
          if (lastFileSize === 0 || lastLogFile !== currentLogFile) {
            const logContent = fs.readFileSync(currentLogFile, 'utf-8');
            const allLines = logContent.split('\n').filter(line => line.trim() !== '');
            const recentLines = allLines.slice(-200); // Last 200 lines
            
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'logs',
              logFile: latestLogFile.name,
              newLines: recentLines,
              reset: true,
              timestamp: new Date().toISOString()
            })}\n\n`));

            lastLines = recentLines;
            lastFileSize = fileStats.size;
            lastLogFile = currentLogFile;
          } else if (fileStats.size > lastFileSize) {
            // File size increased, read new content
            try {
              const fileHandle = fs.openSync(currentLogFile, 'r');
              
              // Read from last position
              const bytesToRead = fileStats.size - lastFileSize;
              const buffer = Buffer.alloc(bytesToRead);
              const bytesRead = fs.readSync(fileHandle, buffer, 0, bytesToRead, lastFileSize);
              fs.closeSync(fileHandle);

              if (bytesRead > 0) {
                const newContent = buffer.slice(0, bytesRead).toString('utf-8');
                const newLines = newContent.split('\n').filter(line => line.trim() !== '');

                if (newLines.length > 0) {
                  // Send new lines
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    type: 'logs',
                    logFile: latestLogFile.name,
                    newLines: newLines,
                    timestamp: new Date().toISOString()
                  })}\n\n`));

                  // Update tracking
                  lastLines = [...lastLines, ...newLines].slice(-1000); // Keep last 1000 lines in memory
                }
              }

              lastFileSize = fileStats.size;
            } catch (readError) {
              // If read fails, file might have been rotated, reset tracking
              console.error('Error reading log file:', readError);
              lastFileSize = 0;
            }
          } else if (fileStats.size < lastFileSize) {
            // File was truncated or recreated, reset
            lastFileSize = 0;
            lastLines = [];
            
            // Send initial content
            const logContent = fs.readFileSync(currentLogFile, 'utf-8');
            const allLines = logContent.split('\n').filter(line => line.trim() !== '');
            const recentLines = allLines.slice(-200); // Last 200 lines
            
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'logs',
              logFile: latestLogFile.name,
              newLines: recentLines,
              reset: true,
              timestamp: new Date().toISOString()
            })}\n\n`));

            lastLines = recentLines;
            lastFileSize = fileStats.size;
          }
          // Note: We don't send heartbeat on every poll to reduce noise
          // The connection stays alive via the SSE protocol itself

        } catch (error) {
          console.error('Error reading scraper logs:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : 'Unknown error'
          })}\n\n`));
        }
      };

      // Send initial logs
      await sendLogs();
      
      // Poll every 1 second for new log entries
      const interval = setInterval(sendLogs, 1000);

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

