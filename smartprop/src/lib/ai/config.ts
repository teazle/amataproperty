/**
 * AI System Configuration Constants
 * Centralized configuration for all AI-related operations
 */

// AI Model Configuration
export const AI_CONFIG = {
  // Groq API Configuration
  MODEL: 'llama-3.1-8b-instant',
  TEMPERATURE: 0.8, // Increased for more natural, varied responses
  FREQUENCY_PENALTY: 0.5, // Reduces repetition of phrases
  PRESENCE_PENALTY: 0.3, // Encourages topic variation
  MAX_TOKENS: {
    CO_BROKING_ANALYSIS: 500,
    TIMESLOT_DETECTION: 300,
    RESPONSE_GENERATION: 200, // Increased for more natural responses
  },
  
  // Timeout and Retry Configuration
  REQUEST_TIMEOUT: 30000, // 30 seconds
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
} as const;

// Human Behavior Simulation
export const HUMAN_BEHAVIOR = {
  // Typing speeds (characters per second)
  TYPING_SPEED: {
    SLOW: 2,
    NORMAL: 4,
    FAST: 6,
  },
  
  // Delays (milliseconds)
  DELAYS: {
    MIN_THINKING: 1000,
    MAX_THINKING: 3000,
    BETWEEN_MESSAGES: 500,
    BEFORE_TYPING: 800,
  },
  
  // Message length thresholds
  MESSAGE_LENGTH: {
    SHORT: 50,
    MEDIUM: 100,
    LONG: 200,
  },
  
  // Probabilities (0-1)
  PROBABILITIES: {
    TYPO_CORRECTION: 0.15,
    PAUSE_THINKING: 0.3,
    VARY_TYPING_SPEED: 0.4,
  },
} as const;

// Conversation Management
export const CONVERSATION = {
  // Time limits
  MAX_DAYS_ELAPSED: 7,
  MAX_DEFLECTIONS: 3,
  
  // Message limits
  MAX_MESSAGE_LENGTH: 500,
  MIN_MESSAGE_LENGTH: 10,
  
  // Analysis thresholds
  CONFIDENCE_THRESHOLD: 0.7,
  ENGAGEMENT_THRESHOLD: 0.5,
  
  // Default values
  DEFAULT_AVAILABILITY: "I'm generally available on weekdays from 9 AM to 6 PM, and weekends by appointment.",
  DEFAULT_AGENT_NAME: "Sarah Chen",
  DEFAULT_CEA_REG: "R123456A",
} as const;

// Business Logic Constants
export const BUSINESS_RULES = {
  // Co-broking statuses
  CO_BROKING_STATUS: {
    WILLING: 'willing',
    NOT_WILLING: 'not_willing',
    NEEDS_DISCUSSION: 'needs_discussion',
    UNKNOWN: 'unknown',
  },
  
  // Timeslot types
  TIMESLOT_TYPES: {
    PROVIDED: 'provided',
    REQUESTED: 'requested',
  },
  
  // Conversation tones
  CONVERSATION_TONES: {
    POSITIVE: 'positive',
    NEUTRAL: 'neutral',
    NEGATIVE: 'negative',
    PROFESSIONAL: 'professional',
  },
  
  // Agent engagement levels
  ENGAGEMENT_LEVELS: {
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
  },
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  NO_ACTIVE_PROMPT: 'No active AI prompt found in database. Please ensure a prompt is configured and active.',
  AI_ANALYSIS_FAILED: 'Failed to analyze conversation with AI',
  GROQ_CLIENT_ERROR: 'Failed to initialize Groq client',
  INVALID_CONTEXT: 'Invalid conversation context provided',
  CIRCUIT_BREAKER_OPEN: 'AI service temporarily unavailable due to circuit breaker',
} as const;

// Success Messages
export const SUCCESS_MESSAGES = {
  OBJECTIVES_MET: "Perfect! Thank you for confirming the co-broking arrangement and sharing your availability. I'll coordinate with my client and get back to you soon with the viewing details.",
  GRACEFUL_EXIT: "Thank you for your time. Feel free to reach out if you have any questions about this property in the future.",
  ACKNOWLEDGMENT: "Thank you for your message. I appreciate your response.",
} as const;

// Logging Configuration
export const LOGGING = {
  LEVELS: {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
  },
  
  CATEGORIES: {
    AI_ANALYSIS: 'ai-analysis',
    CONVERSATION: 'conversation',
    PERFORMANCE: 'performance',
    CIRCUIT_BREAKER: 'circuit-breaker',
  },
} as const;

// Performance Monitoring
export const PERFORMANCE = {
  // Latency thresholds (milliseconds)
  LATENCY_THRESHOLDS: {
    FAST: 1000,
    ACCEPTABLE: 3000,
    SLOW: 5000,
  },
  
  // Monitoring intervals
  MONITORING: {
    HEALTH_CHECK_INTERVAL: 60000, // 1 minute
    METRICS_COLLECTION_INTERVAL: 300000, // 5 minutes
  },
} as const;