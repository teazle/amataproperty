/**
 * Enhanced Conversational AI for Auto-Replies
 * Intelligently continues conversation with agents until we get timeslots
 * Uses pattern recognition, time-based tracking, and graceful persistence
 */

import Groq from 'groq-sdk';
import { sendMessageWithTyping } from '../wa/waha';
import {
ConversationContext as AdvancedConversationContext,
analyzeConversationWithAdvancedAI
} from './conversation-analyzer';
import {
getContextualDelay,
isTypingSimulationEnabled,
TimingContext
} from './human-behavior';
import { getActivePrompt } from './prompt-manager';
import { cleanQuotes,hasQuotes } from './quote-cleaner';

// Lazy initialization
let groq: Groq | null = null;

function getGroqClient(): Groq {
  if (!groq) {
    groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});
  }
  return groq;
}

// Buyer agent profile
const BUYER_AGENT_NAME = process.env.BUYER_AGENT_NAME || "Jeremy";
const _BUYER_AGENT_CEA_REG = process.env.BUYER_AGENT_CEA_REG || "R012345A";
const BUYER_AGENT_AVAILABILITY = process.env.BUYER_AGENT_AVAILABILITY || "Monday to Friday 8pm to 10pm";

// Intelligent limits (no hard reply count limit)
const MAX_DAYS_ELAPSED = 7; // Give up gracefully after 7 days
const MAX_DEFLECTIONS = 4; // Give up gracefully after 4 deflections

// Agent profile structure
export interface AgentProfile {
  name: string;
  agency?: string;
  experience?: string;
}

// Property context structure
export interface PropertyContext {
  title: string;
  price: number;
  district: string;
  propertyType: string;
}

// Conversation message structure
export interface ConversationMessage {
  role: 'user' | 'agent';
  message: string;
  timestamp: string;
}

// Enhanced conversation context with proper state tracking
export interface ConversationContext {
  agentMessage: string;
  conversationHistory: ConversationMessage[];
  currentPhase: string;
  daysElapsed: number;
  deflectionCount: number;
  autoReplyCount?: number;
  timeslots?: string;
  timeslotsDetected?: boolean;
  agentProfile?: AgentProfile;
  propertyContext?: PropertyContext;
  firstMessageSentAt?: Date;
  lastMessageAt?: Date;
  previousCoBrokingStatus?: 'unknown' | 'willing' | 'not_willing' | 'needs_discussion';
  objectivesStatus?: {
    timeslotsReceived: boolean;
    coBrokingConfirmed: boolean;
    coBrokingStatus?: 'willing' | 'not_willing' | 'needs_discussion' | 'unknown';
  };
}

// Enhanced decision with phase tracking and deflection detection
export interface ConversationDecision {
  shouldReply: boolean;
  replyMessage?: string;
  newPhase: string;
  reason: string;
  deflectionDetected: boolean;
  timeslotsReceived: boolean;
  timeslotsDetected: boolean;
  timeslotsText?: string;
  gracefulExit: boolean;
  agentAskedForAvailability?: boolean;
  agentProvidedTimeslots?: boolean;
  coBrokingStatus?: 'unknown' | 'willing' | 'not_willing' | 'needs_discussion';
  coBrokingNotes?: string;
}

export interface CoBrokingAnalysisResult {
  coBrokingStatus: 'unknown' | 'willing' | 'not_willing' | 'needs_discussion';
  reason: string;
}

/**
 * Update objectives status based on conversation history and current message
 * Uses proper state tracking instead of re-analyzing everything
 */
export function updateObjectivesStatus(context: ConversationContext): {
  timeslotsReceived: boolean;
  timeslotsText?: string;
  coBrokingConfirmed: boolean;
  coBrokingStatus?: 'willing' | 'not_willing' | 'needs_discussion' | 'unknown';
} {
  const history = context.conversationHistory || [];

  let timeslotsReceived = false;
  let timeslotsText: string | undefined;

  // Use database status if available, otherwise default to 'unknown'
  let coBrokingStatus: 'willing' | 'not_willing' | 'needs_discussion' | 'unknown' =
    context.objectivesStatus?.coBrokingStatus || 'unknown';
  let coBrokingConfirmed = context.objectivesStatus?.coBrokingConfirmed || false;

  const timeslotPatterns = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'am',
    'pm',
    'morning',
    'afternoon',
    'evening',
    'available',
    'availability',
    'free',
    'can show',
    'timeslot',
    'time slot',
    'slot'
  ];

  const positiveSignals = ['yes', 'ok', 'sure', 'can', 'no problem', 'of course', 'able', 'definitely'];
  const negativeSignals = ['no', 'not willing', 'don\'t co-broke', 'principal only', 'exclusive', 'cannot', 'won\'t'];
  const discussionSignals = ['depends', 'discuss', 'check', 'review', 'let me see'];

  let _lastUserMessage = '';

  for (let i = 0; i < history.length; i++) {
    const text = history[i]?.message?.toLowerCase() || '';

    if (history[i]?.role === 'user') {
      _lastUserMessage = text;
      continue;
    }

    // Analyze agent responses for timeslots
    if (!timeslotsReceived && timeslotPatterns.some(pattern => text.includes(pattern))) {
      timeslotsReceived = true;
      timeslotsText = history[i].message;
    }
  }

  // Analyze agent responses to co-broking questions
  for (let i = 0; i < history.length; i++) {
    const currentMessage = history[i];
    if (!currentMessage) continue;

    const text = currentMessage.message?.toLowerCase() || '';

    // Look for user asking about co-broking, then check agent's response
    if (currentMessage.role === 'user' &&
        (text.includes('co-brok') || text.includes('co bro') || text.includes('cobroke'))) {

      // Check the next message (agent's response)
      const nextMessage = history[i + 1];
      if (nextMessage && nextMessage.role === 'agent') {
        const agentResponse = nextMessage.message?.toLowerCase() || '';

        if (negativeSignals.some(pattern => agentResponse.includes(pattern))) {
          coBrokingStatus = 'not_willing' as const;
          coBrokingConfirmed = false;
        } else if (discussionSignals.some(pattern => agentResponse.includes(pattern))) {
          if (coBrokingStatus !== 'not_willing' && coBrokingStatus !== 'willing') {
            coBrokingStatus = 'needs_discussion' as const;
          }
        } else if (positiveSignals.some(pattern => agentResponse.includes(pattern))) {
          coBrokingStatus = 'willing' as const;
          coBrokingConfirmed = true;
        }
      }
    }
  }

  // Final confirmation check - if database says willing, trust it unless conversation shows otherwise
  if (context.objectivesStatus?.coBrokingStatus === 'willing' && coBrokingStatus !== 'not_willing') {
    coBrokingStatus = 'willing';
    coBrokingConfirmed = true;
  } else {
    // Check if co-broking is confirmed based on final status
    coBrokingConfirmed = coBrokingStatus === 'willing';
  }

  return {
    timeslotsReceived,
    timeslotsText,
    coBrokingConfirmed,
    coBrokingStatus
  };
}

/**
 * NEW: Advanced conversation analysis using intelligent AI
 * This is the recommended approach for production use
 */
export async function analyzeConversationWithAdvancedContext(
  context: ConversationContext,
  agentProfile: { name: string; agency?: string; experience?: string },
  propertyContext: { title: string; price: number; district: string; propertyType: string }
): Promise<ConversationDecision> {
  try {
    // Convert to advanced context format
    const advancedContext: AdvancedConversationContext = {
      agentMessage: context.agentMessage,
      conversationHistory: context.conversationHistory,
      agentProfile,
      propertyContext,
      currentPhase: context.currentPhase,
      daysElapsed: context.daysElapsed
    };

    // Use advanced AI analysis
    const analysis = await analyzeConversationWithAdvancedAI(advancedContext);

    // Convert back to legacy format
    // If recommendedResponse is empty, don't reply
    const hasValidResponse = Boolean(analysis.recommendedResponse && analysis.recommendedResponse.trim().length > 0);
    const shouldReply = analysis.shouldContinue && hasValidResponse;

    return {
      shouldReply,
      replyMessage: hasValidResponse ? analysis.recommendedResponse : undefined,
      newPhase: analysis.coBrokingAnalysis.conversationPhase,
      reason: `Advanced AI analysis: ${analysis.coBrokingAnalysis.reasoning}`,
      deflectionDetected: analysis.conversationTone === 'negative',
      timeslotsReceived: analysis.timeslotsDetected,
      timeslotsDetected: analysis.timeslotsDetected,
      timeslotsText: analysis.timeslotsText,
      gracefulExit: !analysis.shouldContinue,
      coBrokingStatus: analysis.coBrokingAnalysis.status,
      coBrokingNotes: analysis.coBrokingAnalysis.reasoning
    };
  } catch (error) {
    console.error('❌ Advanced analysis failed, falling back to legacy:', error);
    // Fallback to legacy analysis
    return analyzeConversationWithContext(context);
  }
}

/**
 * LEGACY: Analyze conversation with full context and intelligent decision making
 * No hard reply limits - uses pattern recognition and time-based tracking
 * @deprecated Use analyzeConversationWithAdvancedContext instead
 */
export async function analyzeConversationWithContext(
  context: ConversationContext
): Promise<ConversationDecision> {
  // Hard stop condition: Max days elapsed (graceful exit)
  if (context.daysElapsed >= MAX_DAYS_ELAPSED) {
    console.log(`⏰ ${MAX_DAYS_ELAPSED} days elapsed - graceful exit`);
    return {
      shouldReply: true,
      replyMessage: "Hi! Understand you're busy. Feel free to reach out when convenient. Thanks!",
      newPhase: 'gracefully_ended',
      reason: `${MAX_DAYS_ELAPSED} days elapsed`,
      deflectionDetected: false,
      timeslotsReceived: false,
      timeslotsDetected: false,
      gracefulExit: true
    };
  }

  // Hard stop condition: Max deflections (graceful exit)
  if (context.deflectionCount >= MAX_DEFLECTIONS) {
    console.log(`🔄 ${MAX_DEFLECTIONS} deflections reached - graceful exit`);
    return {
      shouldReply: true,
      replyMessage: "Hi! Understand you're busy. Feel free to reach out when convenient. Thanks!",
      newPhase: 'gracefully_ended',
      reason: `${MAX_DEFLECTIONS} deflections reached`,
      deflectionDetected: false,
      timeslotsReceived: false,
      timeslotsDetected: false,
      gracefulExit: true
    };
  }

  // Check if we have both objectives (timeslots + co-broking confirmed)
  const objectives = updateObjectivesStatus(context);

  if (objectives.timeslotsReceived && objectives.coBrokingConfirmed) {
    console.log('✅ Both objectives achieved - sending thank you');
    return {
      shouldReply: true,
      replyMessage: generateThankYouMessage(objectives.timeslotsText || 'the timeslots', objectives.coBrokingStatus),
      newPhase: 'objectives_achieved',
      reason: 'Both timeslots and co-broking confirmed',
      deflectionDetected: false,
      timeslotsReceived: true,
      timeslotsDetected: true,
      gracefulExit: true
    };
  }

  // If agent is not willing to co-broke, end gracefully
  if (objectives.coBrokingStatus === 'not_willing') {
    console.log('❌ Agent not willing to co-broke - graceful exit');
    return {
      shouldReply: false,
      newPhase: 'gracefully_ended',
      reason: 'Agent not willing to co-broke',
      deflectionDetected: false,
      timeslotsReceived: false,
      timeslotsDetected: false,
      gracefulExit: true
    };
  }

  // If we have timeslots but no co-broking confirmation, ask about co-broking
  if (objectives.timeslotsReceived && !objectives.coBrokingConfirmed) {
    console.log('📅 Have timeslots, asking about co-broking');
    return {
      shouldReply: false,
      newPhase: 'awaiting_cobroking_confirmation',
      reason: 'Have timeslots, need co-broking confirmation',
      deflectionDetected: false,
      timeslotsReceived: true,
      timeslotsDetected: true,
      gracefulExit: true
    };
  }
  // Let AI handle all context understanding - no pattern matching
  console.log('🤖 Using AI for all context understanding instead of pattern matching');

  // Already gracefully ended - only reply to direct questions, keep it brief
  if (context.currentPhase === 'gracefully_ended') {
    console.log('🛑 Conversation already gracefully ended, checking for business questions...');

    // Import business question detection
    const { detectBusinessQuestions, generateBusinessQuestionDeflection } = await import('./conversation-analyzer');

    // Check if the message contains business questions
    const businessQuestionAnalysis = detectBusinessQuestions(context.agentMessage);

    if (businessQuestionAnalysis.isBusinessQuestion) {
      // Generate appropriate deflection response
      const deflectionResponse = generateBusinessQuestionDeflection(businessQuestionAnalysis.questionType || 'general');

      return {
        shouldReply: true,
        replyMessage: deflectionResponse,
        newPhase: 'gracefully_ended', // Maintain the gracefully ended phase
        reason: 'Business question deflection',
        deflectionDetected: false,
        timeslotsReceived: false,
        timeslotsDetected: false,
        gracefulExit: true
      };
    }

    // For non-business questions, provide a brief acknowledgment
    const isQuestion = context.agentMessage.includes('?') ||
                      context.agentMessage.toLowerCase().includes('when') ||
                      context.agentMessage.toLowerCase().includes('how') ||
                      context.agentMessage.toLowerCase().includes('what') ||
                      context.agentMessage.toLowerCase().includes('where');

    if (isQuestion) {
      // Give a brief, graceful response to wrap up
      return {
        shouldReply: true,
        replyMessage: "Let me get back to you on that shortly. Looking forward to Tuesday!",
        newPhase: 'gracefully_ended',
        reason: 'Brief response to post-completion question',
        deflectionDetected: false,
        timeslotsReceived: false,
        timeslotsDetected: false,
        gracefulExit: true
      };
    }

    return {
      shouldReply: false,
      newPhase: 'gracefully_ended',
      reason: 'Already gracefully ended',
      deflectionDetected: false,
      timeslotsReceived: false,
      timeslotsDetected: false,
      gracefulExit: true
    };
  }

  // Enhanced phase tracking
  if (context.currentPhase === 'property_unavailable') {
    console.log('❌ Property unavailable - no further action');
    return {
      shouldReply: false,
      newPhase: 'property_unavailable',
      reason: 'Property unavailable',
      deflectionDetected: false,
      timeslotsReceived: false,
      timeslotsDetected: false,
      gracefulExit: true
    };
  }

  // Track conversation progress
  const determinePhase = (context: ConversationContext) => {
    const _history = context.conversationHistory;
    const lastMessage = context.agentMessage.toLowerCase();

    // Check for co-broking confirmation
    const hasCoBrokingConfirmation = lastMessage.includes('yes') &&
      (lastMessage.includes('co-broke') || lastMessage.includes('co broke') || lastMessage.includes('co-broking'));

    // Check for timeslots
    const hasTimeslots = context.timeslotsDetected || context.timeslots ||
      (lastMessage.match(/(?:mon|tue|wed|thu|fri|sat|sun).*\d+(?::\d+)?(?:\s*(?:am|pm))?/i) !== null);

    if (hasCoBrokingConfirmation && hasTimeslots) {
      return 'timeslots_received';
    } else if (hasCoBrokingConfirmation) {
      return 'agent_engaging';
    } else if (hasTimeslots) {
      return 'timeslots_received';
    }

    return context.currentPhase;
  };

  // Update phase based on conversation progress
  context.currentPhase = determinePhase(context);

  // Enhanced timeslot detection
  const detectTimeslots = (message: string): { detected: boolean; slots?: string } => {
    // Common time patterns
    const timePatterns = [
      // Days with times
      /(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*(?:to|-|,|\s)\s*(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-|,|\s)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,

      // Single day with time
      /(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-|,|\s)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i,

      // Just time ranges
      /\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-|,|\s)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i
    ];

    for (const pattern of timePatterns) {
      const match = message.match(pattern);
      if (match) {
        return { detected: true, slots: match[0] };
      }
    }

    return { detected: false };
  };

  const timeslotInfo = detectTimeslots(context.agentMessage);
  if (timeslotInfo.detected) {
    context.timeslots = timeslotInfo.slots;
  }

  // Let AI handle initial message detection instead of pattern matching
  const hasInitialMessage = context.conversationHistory.length > 0;

  if (!hasInitialMessage && context.conversationHistory.length === 0) {
    console.log('⚠️  No initial message found in empty conversation - this should not happen');
    return {
      shouldReply: false,
      newPhase: context.currentPhase,
      reason: 'No initial message in conversation history',
      deflectionDetected: false,
      timeslotsReceived: false,
      timeslotsDetected: false,
      gracefulExit: false
    };
  }

  // All context understanding is now handled by AI analysis
  console.log('🤖 All context understanding delegated to AI analysis');

  // Let AI decide with full context and timeslot information
  console.log('🤖 Analyzing conversation with AI...');
  const aiDecision = await callGroqAIWithContext({
    ...context,
    timeslotsDetected: timeslotInfo.detected
  });

  return aiDecision;
}

/**
 * Call Groq AI with enhanced context and conversation state
 */
async function callGroqAIWithContext(
  context: ConversationContext
): Promise<ConversationDecision> {
  if (!process.env.GROQ_API_KEY) {
    return {
      shouldReply: false,
      newPhase: context.currentPhase,
      reason: 'No AI configured',
      deflectionDetected: false,
      timeslotsReceived: false,
      timeslotsDetected: false,
      gracefulExit: false
    };
  }

  try {
    // Get current date and time context
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'Asia/Singapore',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    const currentDateTime = now.toLocaleString('en-SG', options);
    const _currentDay = now.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', weekday: 'long' });

    // Format conversation history for AI
    const historyText = context.conversationHistory
      .map(msg => `${msg.role === 'user' ? 'You' : 'Agent'}: ${msg.message}`)
      .join('\n');

    // Get dynamic prompt from database - this should always exist now
    const dynamicPrompt = await getActivePrompt();

    if (!dynamicPrompt) {
      throw new Error('No active AI prompt found in database. Please ensure a prompt is configured and active.');
    }

    // Replace template variables in the prompt
    const systemPrompt = dynamicPrompt
      .replace(/\$\{BUYER_AGENT_NAME\}/g, BUYER_AGENT_NAME)
      .replace(/\$\{currentDateTime\}/g, currentDateTime)
      .replace(/\$\{context\.currentPhase\}/g, context.currentPhase)
      .replace(/\$\{context\.daysElapsed\}/g, context.daysElapsed.toString())
      .replace(/\$\{context\.objectivesStatus\?\.timeslotsReceived \? '✓ Timeslots' : '✗ Timeslots'\}/g,
        context.objectivesStatus?.timeslotsReceived ? '✓ Timeslots' : '✗ Timeslots')
      .replace(/\$\{context\.objectivesStatus\?\.coBrokingConfirmed \? '✓ Co-broking' : '✗ Co-broking'\}/g,
        context.objectivesStatus?.coBrokingConfirmed ? '✓ Co-broking' : '✗ Co-broking');

    const client = getGroqClient();
    const completion = await client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: `Agent's latest message: "${context.agentMessage}"

${historyText ? `Previous conversation:\n${historyText}\n` : ''}
Analyze and decide: Should we reply? What phase are we in?`,
        },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7, // Increased for more natural, varied responses
      max_tokens: 600, // Increased to allow more natural responses
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      return {
        shouldReply: false,
        newPhase: context.currentPhase,
        reason: 'Empty AI response',
        deflectionDetected: false,
        timeslotsReceived: false,
        timeslotsDetected: false,
        gracefulExit: false
      };
    }

    const decision = JSON.parse(responseText) as ConversationDecision;
    console.log('🤖 AI Decision:', decision);

    return decision;
  } catch (error) {
    console.error('❌ Error analyzing conversation with AI:', error);
    return {
      shouldReply: false,
      newPhase: context.currentPhase,
      reason: 'AI analysis failed',
      deflectionDetected: false,
      timeslotsReceived: false,
      timeslotsDetected: false,
      gracefulExit: false
    };
  }
}

/**
 * Generate natural thank you messages when timeslots are received
 */
export interface StructuredTimeslotSummary {
  available?: boolean;
  notes?: string | null;
  slots?: Array<{
    day?: string;
    date?: string;
    time?: string;
    formatted?: string;
  }>;
}

function formatDayRanges(days: string[]): string {
  const dayOrder = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const orderIndex = new Map(dayOrder.map((day, index) => [day.toLowerCase(), index]));

  const uniqueDays = [...new Set(days)]
    .map(day => dayOrder.find(d => d.toLowerCase() === day.toLowerCase()) || day)
    .sort((a, b) => (orderIndex.get(a.toLowerCase()) ?? 99) - (orderIndex.get(b.toLowerCase()) ?? 99));

  if (uniqueDays.length === 0) return '';

  const ranges: Array<string> = [];
  let rangeStart = uniqueDays[0];
  let previousDay = uniqueDays[0];

  const flushRange = (endDay: string) => {
    if (!rangeStart) return;
    const startIndex = orderIndex.get(rangeStart.toLowerCase()) ?? 0;
    const endIndex = orderIndex.get(endDay.toLowerCase()) ?? startIndex;
    if (endIndex - startIndex >= 2) {
      ranges.push(`${rangeStart} to ${endDay}`);
    } else if (endIndex - startIndex === 1) {
      ranges.push(`${rangeStart} & ${endDay}`);
    } else {
      ranges.push(rangeStart);
    }
  };

  for (let i = 1; i < uniqueDays.length; i++) {
    const currentDay = uniqueDays[i];
    const prevIndex = orderIndex.get(previousDay.toLowerCase()) ?? -10;
    const currentIndex = orderIndex.get(currentDay.toLowerCase()) ?? -10;
    if (currentIndex - prevIndex === 1) {
      previousDay = currentDay;
      continue;
    }
    flushRange(previousDay);
    rangeStart = currentDay;
    previousDay = currentDay;
  }

  flushRange(previousDay);

  if (ranges.length === 1) {
    return ranges[0];
  }
  if (ranges.length === 2) {
    return `${ranges[0]} & ${ranges[1]}`;
  }
  return `${ranges.slice(0, -1).join(', ')}, and ${ranges[ranges.length - 1]}`;
}

function summarizeStructuredSlots(
  structuredSlots?: StructuredTimeslotSummary | null
): string | null {
  if (!structuredSlots?.available || !structuredSlots.slots?.length) {
    return null;
  }

  const dayRegex = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i;
  const timeRegex = /\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm))?/i;

  const groupMap = new Map<
    string,
    {
      timeLabel: string;
      days: string[];
    }
  >();

  for (const slot of structuredSlots.slots) {
    let timeLabel = slot.time?.trim();
    let day = slot.day?.trim();

    const formatted = slot.formatted || '';
    if (!day && formatted) {
      const dayMatch = formatted.match(dayRegex);
      if (dayMatch) {
        day = dayMatch[0];
      }
    }

    if (!timeLabel && formatted) {
      const timeMatch = formatted.match(timeRegex);
      if (timeMatch) {
        timeLabel = timeMatch[0];
      }
    }

    if (timeLabel) {
      timeLabel = timeLabel
        .replace(/\s+/g, ' ')
        .replace(/\s*-\s*/g, '-')
        .trim();
    }

    if (!day && !timeLabel) {
      continue;
    }

    day = day || 'Any day';
    timeLabel = timeLabel || 'Any time';

    const existing = groupMap.get(timeLabel.toLowerCase());
    if (existing) {
      if (!existing.days.some(d => d.toLowerCase() === day!.toLowerCase())) {
        existing.days.push(day);
      }
    } else {
      groupMap.set(timeLabel.toLowerCase(), {
        timeLabel,
        days: [day],
      });
    }
  }

  if (groupMap.size === 0) {
    return null;
  }

  const phrases: string[] = [];
  for (const { timeLabel, days } of groupMap.values()) {
    const dayPhrase = formatDayRanges(days);
    const trimmedTime = timeLabel?.trim();

    if (!dayPhrase && !trimmedTime) continue;

    if (dayPhrase && trimmedTime) {
      phrases.push(`${dayPhrase}, ${trimmedTime}`);
    } else if (dayPhrase) {
      phrases.push(dayPhrase);
    } else if (trimmedTime) {
      phrases.push(trimmedTime);
    }
  }

  if (!phrases.length) {
    return null;
  }

  if (phrases.length === 1) {
    return phrases[0];
  }

  if (phrases.length === 2) {
    return `${phrases[0]} and ${phrases[1]}`;
  }

  return `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
}

export function describeStructuredSlots(
  structuredSlots?: StructuredTimeslotSummary | null,
  fallback?: string
): string | null {
  const summarized = summarizeStructuredSlots(structuredSlots);
  if (summarized) {
    return summarized;
  }

  if (structuredSlots?.notes && structuredSlots.notes !== 'No viewing slots available') {
    return structuredSlots.notes;
  }

  return fallback ?? null;
}

export function generateThankYouMessage(
  timeslots: string,
  coBrokingStatus?: string,
  options: {
    includeCobrokeQuestion?: boolean;
    structuredSlots?: StructuredTimeslotSummary | null;
  } = {}
): string {
  const includeCobrokeQuestion = options.includeCobrokeQuestion ?? true;
  const structuredSlots = options.structuredSlots;

  const summarizedSlots = describeStructuredSlots(structuredSlots, timeslots);
  const cleanedSummary =
    summarizedSlots && summarizedSlots.toLowerCase().includes('no viewing slots')
      ? null
      : summarizedSlots;
  const availabilitySentence = cleanedSummary
    ? `The slots you suggested (${cleanedSummary}) work great.`
    : 'Those times work great.';

  const baseResponse = `Thanks for sharing the availability. ${availabilitySentence} I'll coordinate with my buyer and confirm the exact timing shortly.`;

  if (coBrokingStatus === 'willing') {
    return baseResponse;
  }

  if (coBrokingStatus === 'needs_discussion') {
    return `${baseResponse} Happy to walk through the co-broking terms when we meet.`;
  }

  if (includeCobrokeQuestion && (!coBrokingStatus || coBrokingStatus === 'unknown')) {
    return `${baseResponse} Would you be open to co-broking on this one?`;
  }

  return baseResponse;
}

/**
 * Generate acknowledgment for updated timeslots
 */
export function generateTimeslotUpdateAcknowledgment(): string {
  // This function should not be used in the new natural conversation system
  // The AI should respond naturally instead of using templates
  return "Thanks for the updated timeslots! Are you open to co-broking?";
}

/**
 * Generate final thank you when BOTH objectives complete
 */
export function generateFinalThankYou(): string {
  // This function should not be used in the new natural conversation system
  // The AI should respond naturally instead of using templates
  return "Perfect! Thanks for confirming the timeslots and co-broking. I'll bring my buyer down on the agreed time. Looking forward to it!";
}

/**
 * Generate graceful exit message
 */
export function generateGracefulExitMessage(reason: 'time' | 'deflections'): string {
  if (reason === 'time') {
    return "Hi! Understand you're busy. Feel free to reach out when convenient. Thanks!";
  } else {
    return "No worries! I'll wait to hear from you. Thanks!";
  }
}

/**
 * Send auto-reply to agent with human-like typing behavior
 * Includes typing indicator and contextual delays
 */
export async function sendAutoReply(
  agentPhone: string,
  replyMessage: string,
  outreachId: string,
  currentAutoReplyCount: number,
  context?: Partial<TimingContext>
): Promise<boolean> {
  try {
    // CRITICAL: Never send empty messages
    if (!replyMessage || replyMessage.trim().length === 0) {
      console.error(`❌ [sendAutoReply] Attempted to send empty message to ${agentPhone} - BLOCKED`);
      console.error(`   This should never happen - empty messages should be filtered earlier`);
      return false;
    }

    // CRITICAL: Remove any quotes before sending (final safety check)
    const originalMessage = replyMessage;
    replyMessage = cleanQuotes(replyMessage);

    // Validate quotes were removed
    if (hasQuotes(replyMessage)) {
      console.warn(`⚠️ [sendAutoReply] Quotes detected in message, cleaning again: "${replyMessage.substring(0, 50)}..."`);
      replyMessage = cleanQuotes(replyMessage);

      if (hasQuotes(replyMessage)) {
        console.error(`❌ [sendAutoReply] Failed to remove quotes after multiple attempts!`);
        console.error(`   Original: "${originalMessage.substring(0, 100)}"`);
        console.error(`   Cleaned: "${replyMessage.substring(0, 100)}"`);
        // Force remove as last resort
        replyMessage = replyMessage.replace(/^["']+|["']+$/g, '').trim();
      }
    }

    // Log if we cleaned quotes
    if (originalMessage !== replyMessage) {
      console.log(`🧹 [sendAutoReply] Cleaned quotes before sending:`, {
        before: originalMessage.substring(0, 60),
        after: replyMessage.substring(0, 60)
      });
    }

    console.log(`📤 Preparing auto-reply #${currentAutoReplyCount + 1} to ${agentPhone}`);
    console.log(`   Message: "${replyMessage}"`);

    // Check if typing simulation is enabled
    if (isTypingSimulationEnabled()) {
      // Calculate contextual delay based on message length and conversation context
      const delay = getContextualDelay(replyMessage.length, context);

      console.log(`⌨️  Simulating human typing: ${delay}ms delay`);

      // Send message with typing indicator
      const result = await sendMessageWithTyping(agentPhone, replyMessage, delay);

      if (!result.success) {
        console.error(`❌ Failed to send auto-reply to ${agentPhone}: ${result.error}`);
        console.error(`   Message was: "${replyMessage.substring(0, 50)}..."`);
        return false;
      }

      console.log(`✅ Auto-reply sent with typing indicator (reply #${currentAutoReplyCount + 1}) to ${agentPhone}`);
      console.log(`   Message ID: ${result.messageId || 'N/A'}`);
      return true;
    } else {
      // Typing simulation disabled - send immediately
      const { sendWhatsAppMessage } = await import('../wa/waha');
      const result = await sendWhatsAppMessage(agentPhone, replyMessage);

      if (!result.success) {
        console.error(`❌ Failed to send auto-reply to ${agentPhone}: ${result.error}`);
        console.error(`   Message was: "${replyMessage.substring(0, 50)}..."`);
        return false;
      }

      console.log(`✅ Auto-reply sent successfully (reply #${currentAutoReplyCount + 1}) to ${agentPhone}`);
      console.log(`   Message ID: ${result.messageId || 'N/A'}`);
      return true;
    }
  } catch (error) {
    console.error('❌ Error sending auto-reply:', error);
    return false;
  }
}

/**
 * Backward compatibility: Old function for simple message analysis
 * (kept for any code that still uses it)
 */
export async function analyzeAgentMessage(
  agentMessage: string,
  conversationHistory: string[]
): Promise<{
  shouldReply: boolean;
  replyMessage?: string;
  reason: string;
  agentAskedForAvailability: boolean;
  agentProvidedTimeslots: boolean;
}> {
  // Convert to new format
  const messages: ConversationMessage[] = conversationHistory.map((msg, idx) => ({
    role: idx % 2 === 0 ? 'user' : 'agent',
    message: msg,
    timestamp: new Date().toISOString()
  }));

  const context: ConversationContext = {
    agentMessage,
    conversationHistory: messages,
    currentPhase: 'agent_engaging',
    daysElapsed: 0,
    deflectionCount: 0,
    autoReplyCount: 0,
    objectivesStatus: {
      timeslotsReceived: false,
      coBrokingConfirmed: false,
      coBrokingStatus: 'unknown'
    }
  };

  const decision = await analyzeConversationWithContext(context);

  return {
    shouldReply: decision.shouldReply,
    replyMessage: decision.replyMessage,
    reason: decision.reason,
    agentAskedForAvailability: decision.agentAskedForAvailability || false,
    agentProvidedTimeslots: decision.timeslotsReceived
  };
}

/**
 * Generate appropriate auto-reply (fallback for backward compatibility)
 */
export function generateAutoReply(decision: {
  replyMessage?: string;
  agentAskedForAvailability?: boolean;
}): string {
  if (decision.replyMessage) {
    return decision.replyMessage;
  }

  if (decision.agentAskedForAvailability) {
    return `I can bring my client down ${BUYER_AGENT_AVAILABILITY}. When are you free?`;
  }

  return `My client is keen. I'm free ${BUYER_AGENT_AVAILABILITY}. When works for you? Do you co broke?`;
}

export function analyzeCoBrokingStatus(message: string): CoBrokingAnalysisResult {
  const lowerMessage = message.toLowerCase();

  // Check for explicit co-broking rejection
  if (lowerMessage.includes('no co-broke') || lowerMessage.includes('no co broke') || lowerMessage.includes('not co-broke')) {
    return {
      coBrokingStatus: 'not_willing' as const,
      reason: 'Agent explicitly rejected co-broking'
    };
  }

  // Check for co-broking discussion needed
  if (lowerMessage.includes('discuss') || lowerMessage.includes('talk') || lowerMessage.includes('check')) {
    return {
      coBrokingStatus: 'needs_discussion' as const,
      reason: 'Agent wants to discuss co-broking terms'
    };
  }

  // Check for co-broking acceptance
  if (lowerMessage.includes('co-broke') || lowerMessage.includes('co broke') || lowerMessage.includes('co-broking')) {
    if (lowerMessage.includes('yes') || lowerMessage.includes('ok') || lowerMessage.includes('sure')) {
      return {
        coBrokingStatus: 'willing' as const,
        reason: 'Agent agreed to co-broking'
      };
    }
  }

  // Default case - need more information
  return {
    coBrokingStatus: 'unknown' as const,
    reason: 'Co-broking status unclear from message'
  };
}
