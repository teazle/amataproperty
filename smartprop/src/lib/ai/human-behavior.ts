/**
 * Human-Like Behavior Utilities
 * Makes AI chatbot feel more natural and human-like with:
 * - Realistic typing delays
 * - Typing indicators
 * - Response variations
 * - Context-aware timing
 */

export interface HumanBehaviorConfig {
  minDelay: number;          // Minimum delay in ms (default: 500)
  maxDelay: number;          // Maximum delay in ms (default: 3000)
  msPerCharacter: number;    // Milliseconds per character (default: 25)
  thinkingPauseMin: number;  // Min thinking pause (default: 300)
  thinkingPauseMax: number;  // Max thinking pause (default: 800)
  enableTypingIndicator: boolean;  // Show typing indicator
  enableVariations: boolean;       // Use response variations
}

// Default configuration based on research (20-25ms per character)
const DEFAULT_CONFIG: HumanBehaviorConfig = {
  minDelay: 500,              // Never faster than 500ms
  maxDelay: 3000,             // Never slower than 3 seconds
  msPerCharacter: 25,         // Average human typing speed
  thinkingPauseMin: 300,      // Brief thinking pause
  thinkingPauseMax: 800,      // Longer thinking pause
  enableTypingIndicator: true,
  enableVariations: false     // Disabled - let AI generate naturally
};

/**
 * Get random number between min and max (inclusive)
 */
function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Calculate realistic typing delay based on message length
 * Formula: (characters * msPerCharacter) + thinkingPause
 * Capped between minDelay and maxDelay
 */
export function calculateTypingDelay(
  messageLength: number,
  config: Partial<HumanBehaviorConfig> = {}
): number {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  // Base typing time (25ms per character mimics human typing speed)
  const typingTime = messageLength * cfg.msPerCharacter;
  
  // Add natural thinking pause
  const thinkingPause = randomBetween(cfg.thinkingPauseMin, cfg.thinkingPauseMax);
  
  // Total delay
  const totalDelay = typingTime + thinkingPause;
  
  // Enforce min/max bounds
  return Math.max(cfg.minDelay, Math.min(totalDelay, cfg.maxDelay));
}

/**
 * Context-aware delay calculation
 * Adjusts timing based on conversation context
 */
export interface TimingContext {
  currentPhase: string;
  deflectionCount: number;
  agentMessageLength: number;
  hasQuestion: boolean;
  isFirstReply: boolean;
}

export function getContextualDelay(
  messageLength: number,
  context: Partial<TimingContext> = {},
  config: Partial<HumanBehaviorConfig> = {}
): number {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  // Base typing delay
  const baseDelay = messageLength * cfg.msPerCharacter;
  
  // Contextual thinking pause
  let thinkingPause = randomBetween(cfg.thinkingPauseMin, cfg.thinkingPauseMax);
  
  // Adjust based on context
  if (context.currentPhase === 'agent_checking') {
    // Quick acknowledgment when agent is checking
    thinkingPause = randomBetween(300, 600);
  } else if (context.deflectionCount && context.deflectionCount >= 2) {
    // Thoughtful response after multiple deflections
    thinkingPause = randomBetween(600, 1000);
  } else if (context.hasQuestion) {
    // Natural response time to questions
    thinkingPause = randomBetween(400, 800);
  } else if (context.isFirstReply) {
    // First reply - reading their message
    thinkingPause = randomBetween(500, 900);
  }
  
  // Add brief "reading" pause for long agent messages
  if (context.agentMessageLength && context.agentMessageLength > 100) {
    thinkingPause += randomBetween(300, 600);
  }
  
  const totalDelay = thinkingPause + baseDelay;
  return Math.max(cfg.minDelay, Math.min(totalDelay, cfg.maxDelay));
}

/**
 * Response variation templates
 * Professional, graceful, and on-brand variations
 */
export interface ResponseVariations {
  [key: string]: string[];
}

const RESPONSE_TEMPLATES: ResponseVariations = {
  // Ask for availability + timeslots + co-broke (graceful, ask agent first)
  'ask_availability_cobroke': [
    "What times work for you this week? I'm generally available evenings. Do you co broke?",
    "When are you free to show the property this week? Can you co broke?",
    "What viewing times do you have available? Are you open to co-broking?",
    "What times work for you? I'm quite flexible. Do you co broke?",
  ],
  
  // Agent asks for our availability (provide brief, then ask theirs)
  'provide_availability': [
    "What times work for you this week? I'm generally available evenings.",
    "When are you free to show? I'm quite flexible on timing.",
    "What viewing times suit you? I'm available most evenings.",
    "What times work best for you? I can work around your schedule.",
  ],
  
  // Agent says call me (polite redirect)
  'decline_call': [
    "WhatsApp is easier for me. What times this week are you free?",
    "I prefer WhatsApp. When this week works for you?",
    "WhatsApp works better for me. What times suit you?",
  ],
  
  // Agent needs to check (graceful, patient)
  'acknowledge_checking': [
    "Sure, no problem! Take your time.",
    "No worries! Let me know when you hear back.",
    "Of course! I'll wait to hear from you.",
    "Sure thing! Take your time to check.",
  ],
  
  // Thank you for timeslots (both objectives met - DON'T say "Happy to co broke")
  'thank_both_objectives': [
    "Perfect! {timeslots} works. Thanks!",
    "Great! {timeslots} suits my schedule. Appreciate it!",
    "Excellent! {timeslots} is good. Thanks!",
    "Sounds good! {timeslots} works for me. Thanks!",
  ],
  
  // Thank you for timeslots (ask about co-broke gently)
  'thank_ask_cobroke': [
    "Perfect! {timeslots} works. Just to confirm, are you open to co-broking?",
    "Great! {timeslots} suits me. Do you co broke?",
    "Excellent! {timeslots} is good. Can you co broke? Thanks!",
  ],
  
  // Ask for specific days (vague time given - softer)
  'ask_specific_days': [
    "Which days work best for you?",
    "What specific times did you have in mind?",
    "Could you share specific viewing times?",
  ],
  
  // Dealbreaker: No co-broke (graceful exit)
  'no_cobroke_exit': [
    "Understood, thanks for letting me know! Appreciate your time.",
    "I see, no problem. Thanks for getting back to me!",
    "Got it, thanks for clarifying. Appreciate your time!",
  ],
  
  // Property unavailable (graceful)
  'property_unavailable': [
    "Thanks for letting me know! Appreciate your time.",
    "I see, thanks for the update! Appreciate it.",
    "Got it, thanks for letting me know!",
  ],
  
  // Agent confirms co-broke (acknowledge and ask for times)
  'cobroke_confirmed_ask_times': [
    "Perfect! What times work for you this week?",
    "Great! When are you free to show the property?",
    "Excellent! What viewing times do you have available?",
  ],
};

/**
 * Get a variation of a response template
 * Randomly selects from available variations
 */
export function getResponseVariation(
  templateKey: string,
  variables: Record<string, string> = {}
): string | null {
  const templates = RESPONSE_TEMPLATES[templateKey];
  
  if (!templates || templates.length === 0) {
    return null;
  }
  
  // Random selection
  const template = templates[Math.floor(Math.random() * templates.length)];
  
  // Replace variables
  let response = template;
  for (const [key, value] of Object.entries(variables)) {
    response = response.replace(`{${key}}`, value);
  }
  
  return response;
}

/**
 * Add controlled imperfections (optional)
 * Occasionally adds human-like self-corrections
 * Use sparingly (5-10% of time) to maintain professionalism
 */
export function maybeAddImperfection(
  message: string,
  probability: number = 0.05
): string {
  // Only apply 5% of the time by default
  if (Math.random() > probability) {
    return message;
  }
  
  const imperfections = [
    (msg: string) => `Let me check... yes, ${msg}`,
    (msg: string) => `Actually, ${msg}`,
    (msg: string) => `Just to confirm - ${msg}`,
  ];
  
  const imperfection = imperfections[Math.floor(Math.random() * imperfections.length)];
  return imperfection(message);
}

/**
 * Sleep utility for adding delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if typing simulation is enabled
 */
export function isTypingSimulationEnabled(): boolean {
  return process.env.ENABLE_TYPING_SIMULATION === 'true';
}

/**
 * Main function: Simulate human-like typing with delay
 * Returns the delay used (for logging)
 */
export async function simulateHumanTyping(
  messageLength: number,
  context: Partial<TimingContext> = {},
  config: Partial<HumanBehaviorConfig> = {}
): Promise<number> {
  if (!isTypingSimulationEnabled()) {
    return 0; // Disabled, no delay
  }
  
  const delay = getContextualDelay(messageLength, context, config);
  await sleep(delay);
  return delay;
}

