import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/scraper/logs
 * Returns the latest scraper log file contents
 * Query params:
 *   - platform: 'edgeprop' | 'propertyguru' (optional, defaults to edgeprop)
 *   - lines: number of lines to return (optional, defaults to 100)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const platform = searchParams.get('platform') || 'edgeprop';
    const lines = parseInt(searchParams.get('lines') || '100', 10);

    // Find the latest log file for the platform
    const logDir = '/tmp';
    const logPattern = platform === 'edgeprop' ? 'ep-scraper-*.log' : 'pg-scraper-*.log';
    
    // Get all matching log files
    const logFiles = fs.readdirSync(logDir)
      .filter(file => file.match(platform === 'edgeprop' ? /^ep-scraper-.*\.log$/ : /^pg-scraper-.*\.log$/))
      .map(file => ({
        name: file,
        path: path.join(logDir, file),
        mtime: fs.statSync(path.join(logDir, file)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()); // Sort by modification time, newest first

    if (logFiles.length === 0) {
      return NextResponse.json({
        success: false,
        error: `No log files found for platform: ${platform}`,
        logFile: null,
        lines: []
      });
    }

    const latestLogFile = logFiles[0];
    
    // Read the log file
    const logContent = fs.readFileSync(latestLogFile.path, 'utf-8');
    const logLines = logContent.split('\n');
    
    // Get the last N lines
    const lastLines = logLines.slice(-lines);
    
    // Also check if there's a lock file for additional status
    const lockFile = path.join(process.cwd(), 'storage', 
      platform === 'edgeprop' ? 'ep-scraper.lock' : 'pg-scraper.lock');
    
    let lockData = null;
    if (fs.existsSync(lockFile)) {
      try {
        lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
      } catch (error) {
        // Ignore parse errors
      }
    }

    return NextResponse.json({
      success: true,
      logFile: latestLogFile.name,
      logPath: latestLogFile.path,
      fileSize: fs.statSync(latestLogFile.path).size,
      totalLines: logLines.length,
      lines: lastLines,
      lockFile: lockData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error reading scraper logs:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      logFile: null,
      lines: []
    }, { status: 500 });
  }
}

