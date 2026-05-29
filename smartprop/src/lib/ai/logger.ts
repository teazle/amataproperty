/**
 * Structured Logging Utility for AI System
 * Replaces console.log patterns with proper logging levels and structured data
 */

import { LOGGING } from './config';

interface LogEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  data?: Record<string, unknown>;
  error?: Error;
}

class Logger {
  private static instance: Logger;
  private isDevelopment: boolean;

  private constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatLogEntry(entry: LogEntry): string {
    const { timestamp, level, category, message, data, error } = entry;
    
    if (this.isDevelopment) {
      // Development: Human-readable format with emojis
      const emoji = this.getLevelEmoji(level);
      let logMessage = `${emoji} [${timestamp}] ${category.toUpperCase()}: ${message}`;
      
      if (data && Object.keys(data).length > 0) {
        logMessage += `\n  Data: ${JSON.stringify(data, null, 2)}`;
      }
      
      if (error) {
        logMessage += `\n  Error: ${error.message}`;
        if (error.stack) {
          logMessage += `\n  Stack: ${error.stack}`;
        }
      }
      
      return logMessage;
    } else {
      // Production: JSON format for log aggregation
      return JSON.stringify({
        timestamp,
        level,
        category,
        message,
        ...(data && { data }),
        ...(error && { 
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name
          }
        })
      });
    }
  }

  private getLevelEmoji(level: string): string {
    switch (level) {
      case LOGGING.LEVELS.ERROR: return '❌';
      case LOGGING.LEVELS.WARN: return '⚠️';
      case LOGGING.LEVELS.INFO: return 'ℹ️';
      case LOGGING.LEVELS.DEBUG: return '🔍';
      default: return '📝';
    }
  }

  private log(level: string, category: string, message: string, data?: Record<string, unknown>, error?: Error): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
      error
    };

    const formattedMessage = this.formatLogEntry(entry);

    switch (level) {
      case LOGGING.LEVELS.ERROR:
        console.error(formattedMessage);
        break;
      case LOGGING.LEVELS.WARN:
        console.warn(formattedMessage);
        break;
      case LOGGING.LEVELS.INFO:
        console.info(formattedMessage);
        break;
      case LOGGING.LEVELS.DEBUG:
        if (this.isDevelopment) {
          console.log(formattedMessage);
        }
        break;
      default:
        console.log(formattedMessage);
    }
  }

  // AI Analysis Logging
  aiAnalysis = {
    start: (operation: string, context?: Record<string, unknown>) => {
      this.log(LOGGING.LEVELS.INFO, LOGGING.CATEGORIES.AI_ANALYSIS, `Starting ${operation}`, context);
    },
    
    success: (operation: string, duration: number, result?: Record<string, unknown>) => {
      this.log(LOGGING.LEVELS.INFO, LOGGING.CATEGORIES.AI_ANALYSIS, `${operation} completed successfully`, {
        duration_ms: duration,
        ...result
      });
    },
    
    error: (operation: string, error: Error, context?: Record<string, unknown>) => {
      this.log(LOGGING.LEVELS.ERROR, LOGGING.CATEGORIES.AI_ANALYSIS, `${operation} failed`, context, error);
    },
    
    debug: (operation: string, data: Record<string, unknown>) => {
      this.log(LOGGING.LEVELS.DEBUG, LOGGING.CATEGORIES.AI_ANALYSIS, `${operation} debug info`, data);
    }
  };

  // Conversation Logging
  conversation = {
    messageReceived: (agentMessage: string, context?: Record<string, unknown>) => {
      this.log(LOGGING.LEVELS.INFO, LOGGING.CATEGORIES.CONVERSATION, 'Agent message received', {
        message: agentMessage,
        ...context
      });
    },
    
    responseGenerated: (response: string, analysis: Record<string, unknown>) => {
      this.log(LOGGING.LEVELS.INFO, LOGGING.CATEGORIES.CONVERSATION, 'Response generated', {
        response,
        analysis
      });
    },
    
    objectivesStatus: (status: Record<string, unknown>) => {
      this.log(LOGGING.LEVELS.INFO, LOGGING.CATEGORIES.CONVERSATION, 'Objectives status updated', status);
    },
    
    analysisComplete: (result: Record<string, unknown>) => {
      this.log(LOGGING.LEVELS.INFO, LOGGING.CATEGORIES.CONVERSATION, 'Conversation analysis completed', result);
    },
    
    conversationEnd: (reason: string, finalStatus: Record<string, unknown>) => {
      this.log(LOGGING.LEVELS.INFO, LOGGING.CATEGORIES.CONVERSATION, `Conversation ended: ${reason}`, finalStatus);
    }
  };

  // Performance Logging
  performance = {
    latency: (operation: string, duration: number, threshold: number) => {
      const level = duration > threshold ? LOGGING.LEVELS.WARN : LOGGING.LEVELS.INFO;
      this.log(level, LOGGING.CATEGORIES.PERFORMANCE, `${operation} latency`, {
        duration_ms: duration,
        threshold_ms: threshold,
        exceeded: duration > threshold
      });
    },
    
    parallelExecution: (operations: string[], totalDuration: number, individualDurations: Record<string, number>) => {
      this.log(LOGGING.LEVELS.INFO, LOGGING.CATEGORIES.PERFORMANCE, 'Parallel execution completed', {
        operations,
        total_duration_ms: totalDuration,
        individual_durations_ms: individualDurations
      });
    }
  };

  // Circuit Breaker Logging
  circuitBreaker = {
    stateChange: (breakerName: string, oldState: string, newState: string, reason?: string) => {
      this.log(LOGGING.LEVELS.WARN, LOGGING.CATEGORIES.CIRCUIT_BREAKER, 
        `Circuit breaker ${breakerName} state changed: ${oldState} → ${newState}`, 
        { reason }
      );
    },
    
    operationBlocked: (breakerName: string, operation: string) => {
      this.log(LOGGING.LEVELS.ERROR, LOGGING.CATEGORIES.CIRCUIT_BREAKER, 
        `Operation blocked by circuit breaker ${breakerName}`, 
        { operation }
      );
    },
    
    operationSuccess: (breakerName: string, operation: string, duration: number) => {
      this.log(LOGGING.LEVELS.DEBUG, LOGGING.CATEGORIES.CIRCUIT_BREAKER, 
        `Operation succeeded through circuit breaker ${breakerName}`, 
        { operation, duration_ms: duration }
      );
    }
  };

  // Generic logging methods
  error = (message: string, error?: Error, data?: Record<string, unknown>) => {
    this.log(LOGGING.LEVELS.ERROR, 'general', message, data, error);
  };

  warn = (message: string, data?: Record<string, unknown>) => {
    this.log(LOGGING.LEVELS.WARN, 'general', message, data);
  };

  info = (message: string, data?: Record<string, unknown>) => {
    this.log(LOGGING.LEVELS.INFO, 'general', message, data);
  };

  debug = (message: string, data?: Record<string, unknown>) => {
    this.log(LOGGING.LEVELS.DEBUG, 'general', message, data);
  };
}

// Export singleton instance
export const logger = Logger.getInstance();

// Export performance measurement utility
export function measurePerformance<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  return new Promise(async (resolve, reject) => {
    const startTime = Date.now();
    
    try {
      logger.aiAnalysis.start(operation);
      const result = await fn();
      const duration = Date.now() - startTime;
      
      logger.aiAnalysis.success(operation, duration);
      resolve({ result, duration });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.aiAnalysis.error(operation, error as Error, { duration_ms: duration });
      reject(error);
    }
  });
}