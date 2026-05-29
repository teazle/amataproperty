import fs from 'fs';
import { NextRequest,NextResponse } from 'next/server';

const LOG_FILE_PATH = '/tmp/linkedin-automation.log';

/**
 * GET /api/linkedin/logs
 * Get LinkedIn automation logs
 * Query params:
 *   - lines: Number of lines to return (default: 200)
 *   - tail: Return only tail of log file (default: true)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const lines = parseInt(searchParams.get('lines') || '200', 10);
    const tailOnly = searchParams.get('tail') !== 'false';

    // Check if log file exists
    if (!fs.existsSync(LOG_FILE_PATH)) {
      return NextResponse.json({
        success: true,
        logs: [],
        totalLines: 0,
        message: 'Log file does not exist yet'
      });
    }

    // Read log file
    let logContent: string;
    try {
      logContent = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
    } catch (error) {
      console.error('Error reading log file:', error);
      return NextResponse.json(
        { error: `Failed to read log file: ${(error instanceof Error ? error.message : String(error))}` },
        { status: 500 }
      );
    }

    // Split into lines
    const allLines = logContent.split('\n').filter(line => line.trim().length > 0);

    // Get requested lines (tail or all)
    let logs: string[];
    if (tailOnly && allLines.length > lines) {
      logs = allLines.slice(-lines);
    } else {
      logs = allLines;
    }

    // Get file stats
    const stats = fs.statSync(LOG_FILE_PATH);

    return NextResponse.json({
      success: true,
      logs,
      totalLines: allLines.length,
      returnedLines: logs.length,
      fileSize: stats.size,
      lastModified: stats.mtime.toISOString()
    });
  } catch (error) {
    console.error('Error getting LinkedIn logs:', error);
    return NextResponse.json(
      { error: (error instanceof Error ? error.message : String(error)) || 'Failed to get logs' },
      { status: 500 }
    );
  }
}

