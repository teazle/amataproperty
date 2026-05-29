/**
 * Circuit Breaker Pattern Implementation for AI Operations
 * Prevents cascade failures by monitoring operation success/failure rates
 */

import { logger } from './logger';

type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringWindow: number;
  name: string;
}

class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  private config: CircuitBreakerConfig;

  constructor(name: string, config: Partial<Omit<CircuitBreakerConfig, 'name'>> = {}) {
    this.config = {
      name,
      failureThreshold: config.failureThreshold || 5,
      resetTimeout: config.resetTimeout || 60000, // 1 minute
      monitoringWindow: config.monitoringWindow || 300000, // 5 minutes
    };
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
        this.setState('HALF_OPEN');
        logger.circuitBreaker.stateChange(this.config.name, 'OPEN', 'HALF_OPEN', 'Reset timeout reached');
      } else {
        logger.circuitBreaker.operationBlocked(this.config.name, 'AI operation');
        throw new Error(`Circuit breaker ${this.config.name} is OPEN`);
      }
    }

    const startTime = Date.now();
    
    try {
      const result = await operation();
      this.onSuccess();
      
      const duration = Date.now() - startTime;
      logger.circuitBreaker.operationSuccess(this.config.name, 'AI operation', duration);
      
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.setState('CLOSED');
      logger.circuitBreaker.stateChange(this.config.name, 'HALF_OPEN', 'CLOSED', 'Operation succeeded in half-open state');
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.failureThreshold) {
      const oldState = this.state;
      this.setState('OPEN');
      logger.circuitBreaker.stateChange(this.config.name, oldState, 'OPEN', 
        `Failure threshold reached: ${this.failureCount}/${this.config.failureThreshold}`);
    }
  }

  private setState(newState: CircuitBreakerState): void {
    const oldState = this.state;
    this.state = newState;
    
    if (oldState !== newState) {
      logger.circuitBreaker.stateChange(this.config.name, oldState, newState);
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      config: this.config
    };
  }
}

// Create circuit breakers for different AI operations
export const coBrokingAnalysisBreaker = new CircuitBreaker('co-broking-analysis', {
  failureThreshold: 3,
  resetTimeout: 30000, // 30 seconds
});

export const timeslotDetectionBreaker = new CircuitBreaker('timeslot-detection', {
  failureThreshold: 3,
  resetTimeout: 30000, // 30 seconds
});

export const responseGenerationBreaker = new CircuitBreaker('response-generation', {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
});

export { CircuitBreaker };