/**
 * Intelligent Conversation Analysis for Co-broking Detection
 * Uses advanced AI to understand conversation context and determine co-broking intent
 */

import Groq from 'groq-sdk';
import { getActivePrompt } from './prompt-manager';
import { coBrokingAnalysisBreaker, timeslotDetectionBreaker, responseGenerationBreaker } from './circuit-breaker';
import { AI_CONFIG, CONVERSATION, BUSINESS_RULES, ERROR_MESSAGES, SUCCESS_MESSAGES } from './config';
import { logger, measurePerformance } from './logger';

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

export interface ConversationContext {
  agentMessage: string;
  conversationHistory: Array<{
    role: 'user' | 'agent';
    message: string;
    timestamp: string;
  }>;
  agentProfile: {
    name: string;
    agency?: string;
    experience?: string;
  };
  propertyContext: {
    title: string;
    price: number;
    district: string;
    propertyType: string;
  };
  currentPhase: string;
  daysElapsed: number;
  timeslots?: string;
  timeslotsDetected?: boolean;
  objectivesStatus?: {
    timeslotsReceived: boolean;
    coBrokingConfirmed: boolean;
    coBrokingStatus?: 'willing' | 'not_willing' | 'needs_discussion' | 'unknown';
  };
}

export interface CoBrokingAnalysis {
  status: 'willing' | 'not_willing' | 'needs_discussion' | 'unknown';
  confidence: number; // 0-1
  reasoning: string;
  extractedTerms?: {
    commissionSplit?: string;
    conditions?: string[];
    timeline?: string;
  };
  nextSteps?: string[];
  conversationPhase: string;
}

/**
 * Analyze conversation for co-broking intent using advanced AI
 */
export async function analyzeCoBrokingIntent(
  context: ConversationContext
): Promise<CoBrokingAnalysis> {
  if (!process.env.GROQ_API_KEY) {
    return {
      status: 'unknown',
      confidence: 0,
      reasoning: 'No AI configured',
      conversationPhase: context.currentPhase
    };
  }

  try {
    const client = getGroqClient();
    
    // Create comprehensive conversation context
    const conversationText = context.conversationHistory
      .map(msg => `${msg.role === 'user' ? 'Buyer Agent' : 'Property Agent'}: ${msg.message}`)
      .join('\n');

    const systemPrompt = `You are an expert real estate conversation analyst specializing in co-broking negotiations. Your task is to analyze conversations between property agents and buyer agents to determine co-broking willingness and extract key terms.

ANALYSIS FRAMEWORK:
1. **Intent Detection**: Look for explicit and implicit signals about co-broking willingness
2. **Context Understanding**: Consider the conversation flow, agent experience, and property context
3. **Confidence Scoring**: Rate your confidence based on clarity of signals
4. **Term Extraction**: Identify specific terms, conditions, and next steps mentioned

CRITICAL: You must understand conversation CONTEXT, not just individual messages. Consider:
- What question was the agent responding to?
- What is the overall conversation flow?
- How does this message relate to previous messages?
- What is the agent's intent based on the conversation context?

CO-BROKING SIGNALS TO DETECT:

**WILLING (High Confidence)**:
- Direct agreement: "Yes, I can co-broke", "Sure, let's co-broke"
- Positive responses: "No problem", "Of course", "I'm open to it"
- Asking about terms: "What's your commission split?", "How do you want to structure this?"
- Proactive suggestions: "We can work together", "Let's discuss the details"
- Contextual agreement: Any positive response to a co-broking question, regardless of phrasing
- Informal agreement: "Ok sure", "Sure thing", "Ok can", "Yes sure", "Sure yes", "Ok", "Sure", "Yes", "Can", "No problem", "Of course"
- When responding to co-broking questions, even casual responses like "ok sure" indicate agreement

**NOT WILLING (High Confidence)**:
- Direct refusal: "No co-broking", "Principal only", "Exclusive listing"
- Policy statements: "Company policy doesn't allow", "We don't do co-broking"
- Deflection: "Not interested", "Not our practice"

**NEEDS DISCUSSION (Medium-High Confidence)**:
- Conditional responses: "Depends on terms", "Let's discuss", "Need to check"
- Questions about process: "How does it work?", "What are the requirements?"
- Hesitation: "I need to think about it", "Let me check with my team"

**UNKNOWN (Low Confidence)**:
- Vague responses: "Maybe", "I'll consider", "Let me get back to you"
- Off-topic responses that don't address co-broking
- Very short responses that don't provide context

CONTEXTUAL ANALYSIS RULES:
1. **Question-Response Context**: If the agent is responding to a direct co-broking question, even informal responses like "ok", "sure", "can", "yes" should be considered positive
2. **Conversation Flow**: Track the conversation flow to understand what each message is responding to
3. **Intent Inference**: Use conversation context to infer intent, not just literal meaning
4. **Informal Language**: Real estate agents often use informal language - understand the intent behind casual responses
5. **Context is King**: "Ok sure" in response to "Are you open to co-broking?" = WILLING. "Ok sure" in response to "How are you?" = UNKNOWN
6. **Be Contextually Intelligent**: Don't be overly conservative - understand the conversation flow and respond accordingly

CONFIDENCE SCORING:
- 0.9-1.0: Very clear, explicit statements
- 0.7-0.8: Strong implicit signals with context
- 0.5-0.6: Moderate signals, some ambiguity
- 0.3-0.4: Weak signals, high ambiguity
- 0.0-0.2: No clear signals or contradictory information

PROPERTY CONTEXT:
- Property: ${context.propertyContext.title}
- Price: $${context.propertyContext.price?.toLocaleString()}
- District: ${context.propertyContext.district}
- Type: ${context.propertyContext.propertyType}

AGENT PROFILE:
- Name: ${context.agentProfile.name}
- Agency: ${context.agentProfile.agency || 'Unknown'}
- Experience: ${context.agentProfile.experience || 'Unknown'}

CONVERSATION PHASE: ${context.currentPhase}
DAYS ELAPSED: ${context.daysElapsed}

Return your analysis as a JSON object with the following structure:
{
  "status": "willing|not_willing|needs_discussion|unknown",
  "confidence": 0.0-1.0,
  "reasoning": "Detailed explanation of your analysis",
  "extractedTerms": {
    "commissionSplit": "Any mentioned commission split",
    "conditions": ["List of conditions mentioned"],
    "timeline": "Any timeline mentioned"
  },
  "nextSteps": ["Recommended next steps for the conversation"],
  "conversationPhase": "Updated conversation phase"
}`;

    const completion = await client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: `Analyze this conversation for co-broking intent:

CONVERSATION HISTORY:
${conversationText}

LATEST MESSAGE FROM PROPERTY AGENT:
"${context.agentMessage}"

IMPORTANT: Analyze the CONVERSATION CONTEXT, not just individual messages. 

CRITICAL CONTEXT UNDERSTANDING - READ CAREFULLY:
- Read the ENTIRE conversation history from top to bottom
- Look for this pattern: "Are you open to co-broking arrangements?" → ANY positive response = CO-BROKING AGREED
- Positive responses include: "yes", "sure", "ok", "yes i just told you", "yes i can co-broke", "of course", "no problem"
- If someone says "yes i just told you" after being asked about co-broking, they are CONFIRMING they already agreed
- **CRITICAL**: If someone provides timeslots in response to a co-broking question, it implies they are WILLING to co-broke
- **CRITICAL**: Timeslots like "monday to wed 6pm to 9pm" or "tuesday and thursday 2pm-5pm" indicate willingness to co-broke
- If someone provides timeslots after co-broking is agreed, BOTH objectives are met
- Look for the conversation flow: co-broking question → agreement OR timeslots → COMPLETE
- NEVER ask about co-broking again if timeslots have been provided

EXAMPLES OF CO-BROKING AGREEMENT:
- "Are you open to co-broking arrangements?" → "yes" = AGREED
- "Are you open to co-broking arrangements?" → "yes i just told you" = AGREED  
- "Are you open to co-broking arrangements?" → "sure" = AGREED
- "Are you open to co-broking arrangements?" → "ok" = AGREED
- "Are you open to co-broking arrangements?" → "What timeslots ?" = AGREED (asking for timeslots = willingness)
- "Are you open to co-broking arrangements?" → "What time?" = AGREED (asking for timing = willingness)
- "Are you open to co-broking arrangements?" → "When?" = AGREED (asking for scheduling = willingness)
- "Are you open to co-broking arrangements?" → "monday to wed 6pm to 9pm" = AGREED (timeslots = willingness)
- "Are you open to co-broking arrangements?" → "tuesday and thursday 2pm-5pm" = AGREED (timeslots = willingness)

SPECIFIC EXAMPLE TO UNDERSTAND:
If the conversation shows:
1. "Are you open to co-broking arrangements?" (Buyer Agent asks)
2. "yes i just told you" (Property Agent responds)
3. "monday to friday 6pm to 9pm" (Property Agent provides timeslots)

This means:
- Co-broking is AGREED (step 2)
- Timeslots are provided (step 3)
- BOTH objectives are met - conversation should end with thank you message

Use your understanding of conversation flow and context to make intelligent inferences about intent. Be contextually intelligent, not overly conservative.

Please provide a detailed analysis of the co-broking intent, confidence level, and recommended next steps.`,
        },
      ],
      model: AI_CONFIG.MODEL,
      temperature: 0.3, // Lower temperature for more consistent analysis
      max_tokens: AI_CONFIG.MAX_TOKENS.CO_BROKING_ANALYSIS,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new Error('Empty AI response');
    }

    const analysis = JSON.parse(responseText) as CoBrokingAnalysis;
    
    // Validate the response
    if (!['willing', 'not_willing', 'needs_discussion', 'unknown'].includes(analysis.status)) {
      analysis.status = 'unknown';
    }
    
    if (analysis.confidence < 0 || analysis.confidence > 1) {
      analysis.confidence = 0.5; // Default to medium confidence
    }

    console.log('🤖 Co-broking Analysis:', {
      status: analysis.status,
      confidence: analysis.confidence,
      reasoning: analysis.reasoning?.substring(0, 100) + '...'
    });

    return analysis;

  } catch (error: unknown) {
    console.error('❌ Error analyzing co-broking intent:', error);
    return {
      status: 'unknown',
      confidence: 0,
      reasoning: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      conversationPhase: context.currentPhase
    };
  }
}

/**
 * Enhanced conversation analysis that considers multiple factors
 */
export async function analyzeConversationWithAdvancedAI(
  context: ConversationContext
): Promise<{
  coBrokingAnalysis: CoBrokingAnalysis;
  timeslotsDetected: boolean;
  timeslotsText?: string;
  timeslotType?: 'provided' | 'requested';
  conversationTone: 'positive' | 'neutral' | 'negative' | 'professional';
  agentEngagement: 'high' | 'medium' | 'low';
  recommendedResponse: string;
  shouldContinue: boolean;
  businessQuestionDetected?: boolean;
  businessQuestionType?: string;
}> {
  logger.conversation.messageReceived(context.agentMessage, {
    historyLength: context.conversationHistory.length,
    currentPhase: context.currentPhase,
    daysElapsed: context.daysElapsed
  });

  // Detect business questions first to handle them appropriately
  const businessQuestionResult = detectBusinessQuestions(context.agentMessage);
  
  // Detect personal questions (like "Are you a bot?")
  const isPersonalQuestion = isDirectPersonalQuestion(context.agentMessage);
  
  // Run AI analyses in parallel to reduce latency, with circuit breaker protection
  const parallelStartTime = Date.now();
  const [coBrokingResult, timeslotResult] = await Promise.all([
    measurePerformance('co-broking-analysis', () => 
      coBrokingAnalysisBreaker.execute(() => analyzeCoBrokingIntent(context))
    ),
    measurePerformance('timeslot-detection', () =>
      timeslotDetectionBreaker.execute(() => detectTimeslots(context.conversationHistory, context.agentMessage))
    )
  ]);

  const parallelDuration = Date.now() - parallelStartTime;
  logger.performance.parallelExecution(
    ['co-broking-analysis', 'timeslot-detection'],
    parallelDuration,
    {
      'co-broking-analysis': coBrokingResult.duration,
      'timeslot-detection': timeslotResult.duration
    }
  );

  const coBrokingAnalysis = coBrokingResult.result;
  const timeslotsDetected = timeslotResult.result.detected;
  const timeslotsText = timeslotResult.result.text;
  const timeslotType = timeslotResult.result.type;

  logger.aiAnalysis.debug('parallel-analysis-results', {
    coBrokingAnalysis,
    timeslotsDetected,
    timeslotType
  });
  
  // Analyze conversation tone
  const conversationTone = analyzeConversationTone(context);
  
  // Assess agent engagement
  const agentEngagement = assessAgentEngagement(context);
  
  // Determine if conversation should continue FIRST
  const shouldContinue = determineConversationContinuation(
    coBrokingAnalysis,
    timeslotsDetected,
    context
  );
  
  // Check if both objectives are met (completion case)
  // Only if timeslots are PROVIDED (not requested), assume co-broking is willing
  const effectiveCoBrokingStatus = timeslotsDetected && timeslotType === 'provided' && coBrokingAnalysis.status === 'unknown' 
    ? 'willing' 
    : coBrokingAnalysis.status;
  
  // Both objectives are met only when co-broking is willing AND timeslots are PROVIDED
  const bothObjectivesMet = effectiveCoBrokingStatus === 'willing' && timeslotsDetected && timeslotType === 'provided';
  
  // Generate appropriate response based on conversation state
  const effectiveCoBrokingAnalysis = {
    ...coBrokingAnalysis,
    status: effectiveCoBrokingStatus
  };
  
  // Generate response based on question type priority: Personal > Business > Normal
  let recommendedResponse: string;
  
  if (isPersonalQuestion) {
    // Handle personal questions like "Are you a bot?" with natural deflection
    recommendedResponse = generatePersonalQuestionResponse(context.agentMessage, context);
    logger.conversation.responseGenerated(recommendedResponse, { type: 'personal' });
  } else if (businessQuestionResult.isBusinessQuestion && businessQuestionResult.questionType) {
    // Generate deflection response for business questions
    const deflectionResponse = generateBusinessQuestionDeflection(businessQuestionResult.questionType);
    
    // Check conversation patterns to determine if we should also ask for next steps
    const patterns = analyzeConversationPatterns(context);
    const coBrokingConfirmed = effectiveCoBrokingStatus === 'willing' || 
                              effectiveCoBrokingStatus === 'needs_discussion' ||
                              patterns.lastCobrokingResponse === 'positive';
    const timeslotsReceived = (timeslotsDetected && timeslotType === 'provided') || 
                             context.objectivesStatus?.timeslotsReceived ||
                             patterns.lastTimeslotResponse === 'provided';
    
    // Combine deflection with appropriate next step if objectives aren't met
    if (coBrokingConfirmed && !timeslotsReceived) {
      recommendedResponse = `${deflectionResponse} In the meantime, could you share your availability for viewing this week?`;
    } else if (!coBrokingConfirmed) {
      recommendedResponse = `${deflectionResponse} Are you open to co-broking on this property?`;
    } else {
      recommendedResponse = deflectionResponse;
    }
    
    logger.conversation.responseGenerated(recommendedResponse, { 
      type: 'business-deflection',
      questionType: businessQuestionResult.questionType,
      coBrokingConfirmed,
      timeslotsReceived
    });
  } else {
    // Use normal response generation for non-business questions with circuit breaker protection
    const naturalResponse = await measurePerformance('response-generation', () =>
      responseGenerationBreaker.execute(() => 
        generateNaturalResponse(
          effectiveCoBrokingAnalysis,
          timeslotsDetected,
          conversationTone,
          agentEngagement,
          context,
          shouldContinue,
          timeslotType
        )
      )
    );
    recommendedResponse = naturalResponse.result;
    
    logger.conversation.responseGenerated(recommendedResponse, { 
      type: 'natural',
      generationDuration: naturalResponse.duration
    });
  }

  // Check if the agent is asking a direct personal question that needs an answer
  const isDirectQuestion = isDirectPersonalQuestion(context.agentMessage);
  
  // Check if it's a simple acknowledgment when objectives are met
  const isAcknowledgment = isSimpleAcknowledgment(context.agentMessage);
  
  // If response is empty, don't continue regardless of other conditions
  const isEmptyResponse = !recommendedResponse || recommendedResponse.trim().length === 0;
  if (isEmptyResponse) {
    console.log('⚠️ Empty response generated, setting shouldContinue to false');
  }
  
  // Only stop conversation if both objectives are met AND (it's not a direct question OR it's a simple acknowledgment)
  // Also stop if response is empty
  const finalShouldContinue = isEmptyResponse ? false : (bothObjectivesMet && (!isDirectQuestion || isAcknowledgment) ? false : shouldContinue);

  const result = {
    coBrokingAnalysis,
    timeslotsDetected,
    timeslotsText,
    timeslotType,
    conversationTone,
    agentEngagement,
    recommendedResponse,
    shouldContinue: finalShouldContinue,
    businessQuestionDetected: businessQuestionResult.isBusinessQuestion,
    businessQuestionType: businessQuestionResult.questionType || undefined
  };

  logger.conversation.analysisComplete({
    shouldContinue: finalShouldContinue,
    coBrokingStatus: coBrokingAnalysis.status,
    timeslotsDetected,
    businessQuestionDetected: businessQuestionResult.isBusinessQuestion
  });

  return result;
}

/**
 * Detect timeslots in conversation history using AI
 * Analyzes the entire conversation to understand if timeslots were provided or requested
 */
async function detectTimeslots(conversationHistory: Array<{role: 'user' | 'agent'; message: string; timestamp: string}>, currentMessage: string): Promise<{ detected: boolean; text?: string; type?: 'provided' | 'requested' }> {
  try {
    const client = getGroqClient();
    
    // Build conversation context for AI analysis
    const conversationContext = conversationHistory
      .slice(-6) // Last 6 messages for context
      .map(msg => `${msg.role}: ${msg.message}`)
      .join('\n');
    
    const completion = await client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are an AI assistant that detects viewing timeslots or timeslot requests in property agent conversations.

TASK: Analyze the ENTIRE conversation history to determine if timeslots have been provided or requested by the agent.

IMPORTANT: Look at the FULL conversation context, not just the current message. If timeslots were provided in earlier messages, they should still be detected even if the current message doesn't contain them.

TIMESLOT INDICATORS:
- Days of the week: "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
- Time ranges: "6pm to 9pm", "2pm-5pm", "morning", "afternoon", "evening"
- Specific times: "6pm", "2pm", "9am"
- Availability: "available", "free", "can show"

TIMESLOT REQUESTS (agent asking for OUR availability):
- "What timeslots?", "What time?", "When?", "What times work?"
- "When are you available?", "When can we meet?"
- "What's your availability?", "When works for you?"

TIMESLOT PROVIDED (agent giving THEIR availability):
- "monday to wed 6pm to 9pm"
- "tuesday and thursday 2pm-5pm"
- "anytime this week"
- "monday morning"

ANALYSIS PRIORITY:
1. If agent has PROVIDED timeslots in ANY previous message, return type: "provided"
2. If agent has only REQUESTED timeslots, return type: "requested"
3. If no timeslots mentioned at all, return detected: false

EXAMPLES:
- Agent says "monday to wed 6pm to 9pm" then later "what is the buyer profile?" = DETECTED (type: "provided") - timeslots were already given
- Agent says "What timeslots?" = DETECTED (type: "requested")
- Agent says "yes" with no timeslot context = NOT DETECTED

Respond with JSON: {"detected": true/false, "text": "extracted timeslot text if detected", "type": "provided" or "requested"}`,
        },
        {
          role: 'user',
          content: `Analyze this conversation for timeslots:

CONVERSATION HISTORY:
${conversationContext}

CURRENT MESSAGE: "${currentMessage}"

Focus on whether the agent has provided or requested timeslots anywhere in this conversation.`,
        },
      ],
      model: AI_CONFIG.MODEL,
      temperature: 0.1,
      max_tokens: AI_CONFIG.MAX_TOKENS.TIMESLOT_DETECTION,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      return { detected: false };
    }

    const result = JSON.parse(responseText) as { detected: boolean; text?: string; type?: 'provided' | 'requested' };
    return result;
  } catch (error: unknown) {
    console.error('❌ Error detecting timeslots:', error);
    return { detected: false };
  }
}

/**
 * Analyze conversation tone - Let AI handle this
 */
function analyzeConversationTone(context: ConversationContext): 'positive' | 'neutral' | 'negative' | 'professional' {
  // Let AI handle tone analysis instead of pattern matching
  // This is just a placeholder - the AI will determine tone contextually
  return 'neutral';
}

/**
 * Assess agent engagement level - Let AI handle this
 */
function assessAgentEngagement(context: ConversationContext): 'high' | 'medium' | 'low' {
  // Let AI handle engagement assessment instead of pattern matching
  // This is just a placeholder - the AI will determine engagement contextually
  return 'medium';
}

/**
 * Generate completion message when both objectives are met
 */
function generateCompletionMessage(context: ConversationContext): string {
  // Check conversation history to see if we've already sent a completion message
  const recentMessages = context.conversationHistory
    .filter(msg => msg.role === 'user')
    .slice(-3); // Check last 3 user messages
  
  // Check if we've already sent a completion message
  const completionPatterns = [
    'thank you for confirming',
    'coordinate with my buyer',
    'get back to you',
    'appreciate your openness'
  ];
  
  const hasAlreadySentCompletion = recentMessages.some(msg => 
    completionPatterns.some(pattern => 
      msg.message.toLowerCase().includes(pattern)
    )
  );
  
  if (hasAlreadySentCompletion) {
    // Don't send another completion message if we've already sent one
    console.log('⚠️ Completion message already sent, skipping duplicate');
    return '';
  }
  
  // Generate varied completion messages without exclamation marks
  const completionMessages = [
    `Thank you for confirming co-broking and providing the viewing times. I'll coordinate with my buyer and get back to you shortly.`,
    `Perfect. I appreciate your openness to co-broking and the viewing times. I'll check with my buyer and confirm the details.`,
    `Thank you. I have the viewing times and co-broking confirmation. I'll coordinate with my buyer and get back to you soon.`,
    `Great. Thank you for the timeslots and co-broking confirmation. I'll check with my buyer and confirm the arrangement.`
  ];
  
  // Select a message that hasn't been used recently
  const usedMessages = recentMessages.map(msg => msg.message.toLowerCase());
  const availableMessages = completionMessages.filter(msg => 
    !usedMessages.some(used => used.includes(msg.substring(0, 30).toLowerCase()))
  );
  
  // Use an available message or fall back to first one if all have been used
  return availableMessages.length > 0 
    ? availableMessages[0] 
    : completionMessages[0];
}

/**
 * Detect if message contains business questions that should be deflected
 */
export function detectBusinessQuestions(message: string): {
  isBusinessQuestion: boolean;
  questionType: 'commission' | 'buyer_details' | 'terms' | 'market' | 'pricing' | 'general' | null;
} {
  const lowerMessage = message.toLowerCase();
  
  // Commission-related questions
  if (lowerMessage.includes('commission') || lowerMessage.includes('split') || 
      lowerMessage.includes('percentage') || lowerMessage.includes('%')) {
    return { isBusinessQuestion: true, questionType: 'commission' };
  }
  
  // Buyer details questions - enhanced to catch more variations
  if ((lowerMessage.includes('buyer') && (lowerMessage.includes('who') || lowerMessage.includes('budget') || 
      lowerMessage.includes('financial') || lowerMessage.includes('qualify') || lowerMessage.includes('profile'))) ||
      lowerMessage.includes('buyer profile') || lowerMessage.includes('buyer\'s profile') ||
      (lowerMessage.includes('what') && lowerMessage.includes('buyer')) ||
      (lowerMessage.includes('who') && (lowerMessage.includes('client') || lowerMessage.includes('customer')))) {
    return { isBusinessQuestion: true, questionType: 'buyer_details' };
  }
  
  // Terms and conditions
  if (lowerMessage.includes('terms') || lowerMessage.includes('condition') || 
      lowerMessage.includes('contract') || lowerMessage.includes('agreement')) {
    return { isBusinessQuestion: true, questionType: 'terms' };
  }
  
  // Market questions
  if (lowerMessage.includes('market') || lowerMessage.includes('price trend') || 
      lowerMessage.includes('valuation') || lowerMessage.includes('comparable')) {
    return { isBusinessQuestion: true, questionType: 'market' };
  }
  
  // Pricing negotiations
  if (lowerMessage.includes('price') && (lowerMessage.includes('negotiate') || 
      lowerMessage.includes('offer') || lowerMessage.includes('discount'))) {
    return { isBusinessQuestion: true, questionType: 'pricing' };
  }
  
  return { isBusinessQuestion: false, questionType: null };
}

/**
 * Generate deflection response for business questions
 */
export function generateBusinessQuestionDeflection(questionType: string): string {
  const deflectionResponses = {
    commission: "I'd prefer to discuss the commission details when we meet in person. I find it's more productive to handle those specifics face-to-face.",
    buyer_details: "I'd be happy to share more about my buyer's profile and requirements during our viewing. It's better discussed in person.",
    terms: "We can go over all the terms and conditions when we meet. I find it's more productive to discuss these details face-to-face.",
    market: "That's a good question. I'd appreciate discussing the market dynamics when we meet. I'd value your insights as well.",
    pricing: "I'd prefer to save the pricing discussion for our meeting. It's better to handle these conversations in person.",
    general: "I appreciate your interest. Let's discuss this further when we meet. I look forward to our conversation."
  };
  
  return deflectionResponses[questionType as keyof typeof deflectionResponses] || deflectionResponses.general;
}

/**
 * Generate natural response for personal questions like "Are you a bot?"
 */
export function generatePersonalQuestionResponse(message: string, context: ConversationContext): string {
  const lowerMessage = message.toLowerCase().trim();
  
  // Handle bot/AI questions with natural deflection
  if (lowerMessage.includes('are you a bot') || 
      lowerMessage.includes('are you ai') ||
      lowerMessage.includes('are you artificial') ||
      lowerMessage.includes('are you human') ||
      lowerMessage.includes('are you real')) {
    
    // Check conversation patterns to determine next steps
    const patterns = analyzeConversationPatterns(context);
    
    // Check conversation history for timeslots (more reliable than context.objectivesStatus)
    const conversationHasTimeslots = context.conversationHistory.some(msg => {
      if (msg.role === 'agent') {
        const msgLower = msg.message.toLowerCase();
        return (msgLower.match(/(mon|tue|wed|thu|fri|sat|sun)/i) && msgLower.match(/\d+\s*(am|pm|:\d+)/i)) ||
               (msgLower.includes('pm') || msgLower.includes('am')) ||
               msgLower.includes('friday') || msgLower.includes('saturday') || msgLower.includes('sunday');
      }
      return false;
    });
    
    const coBrokingConfirmed = context.objectivesStatus?.coBrokingConfirmed || 
                              context.objectivesStatus?.coBrokingStatus === 'willing' ||
                              patterns.lastCobrokingResponse === 'positive';
    const timeslotsReceived = context.objectivesStatus?.timeslotsReceived || 
                             patterns.lastTimeslotResponse === 'provided' ||
                             conversationHasTimeslots;
    const bothObjectivesMet = coBrokingConfirmed && timeslotsReceived;
    
    // Base deflection response - graceful and professional
    const baseResponse = "I'm Jeremy, a buyer's agent working with interested clients.";
    
    // If both objectives are met, don't ask about co-broking - just acknowledge
    if (bothObjectivesMet) {
      return `${baseResponse} Everything is confirmed. I'll coordinate with my buyer and get back to you soon.`;
    }
    
    // Add appropriate next step based on conversation state
    if (coBrokingConfirmed && !timeslotsReceived) {
      return `${baseResponse} Could you share your availability for viewing this week?`;
    } else if (!coBrokingConfirmed) {
      return `${baseResponse} Are you open to co-broking on this property?`;
    } else {
      return `${baseResponse} I look forward to working together.`;
    }
  }
  
  // Handle identity questions
  if (lowerMessage.includes('who are you') ||
      lowerMessage.includes('what are you') ||
      lowerMessage.includes('your name')) {
    return "I'm Jeremy, a buyer's agent. I have a buyer interested in your property. Are you open to co-broking?";
  }
  
  // Handle simple greetings
  if (lowerMessage === 'hello' || lowerMessage === 'hi' || lowerMessage === 'hey') {
    return "Hello. I'm Jeremy, a buyer's agent. I have a buyer interested in your property. Are you open to co-broking?";
  }
  
  // Handle acknowledgments
  if (lowerMessage === 'thanks' || lowerMessage === 'thank you' || 
      lowerMessage === 'ok' || lowerMessage === 'okay') {
    return "You're welcome. Are you open to co-broking on this property?";
  }
  
  // Default response for other personal questions
  return "I'm Jeremy, a buyer's agent with an interested buyer. Are you open to co-broking on this property?";
}

/**
 * Detect if message contains direct personal questions that should be answered
 */
function isDirectPersonalQuestion(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim();
  
  // Direct questions about being a bot or AI
  if (lowerMessage.includes('are you a bot') || 
      lowerMessage.includes('are you ai') ||
      lowerMessage.includes('are you artificial') ||
      lowerMessage.includes('are you human') ||
      lowerMessage.includes('are you real')) {
    return true;
  }
  
  // Direct personal questions
  if (lowerMessage.includes('who are you') ||
      lowerMessage.includes('what are you') ||
      lowerMessage.includes('your name') ||
      (lowerMessage.includes('what') && lowerMessage.includes('do you do'))) {
    return true;
  }
  
  // Greetings that deserve a response (but not simple acknowledgments)
  if (lowerMessage === 'hello' || lowerMessage === 'hi' || 
      lowerMessage === 'hey') {
    return true;
  }

  return false;
}

/**
 * Check if message is a simple acknowledgment that doesn't require further conversation
 * when both objectives are already met
 */
function isSimpleAcknowledgment(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim();
  
  // Simple acknowledgments that indicate conversation can end
  // Check for exact matches AND combinations
  const exactMatches = [
    'ok', 'okay', 'thanks', 'thank you', 'got it', 'understood', 
    'sure', 'alright', 'good', 'testing', 'test'
  ];
  
  // Check exact match first
  if (exactMatches.includes(lowerMessage)) {
    return true;
  }
  
  // Check for combinations like "ok thank you", "ok thanks", etc.
  const acknowledgmentPatterns = [
    /^(ok|okay|sure|alright|got it|understood)\s+(thank you|thanks|thank)/i,
    /^(thank you|thanks|thank)\s+(ok|okay|sure|alright|got it|understood)/i,
    /^(ok|okay|sure|alright|got it|understood)$/i,
    /^(thank you|thanks|thank)$/i,
  ];
  
  return acknowledgmentPatterns.some(pattern => pattern.test(lowerMessage));
}

/**
 * Generate contextual response based on analysis
 * Prioritizes co-broking discussion first, then timeslots
 */
async function generateNaturalResponse(
  coBrokingAnalysis: CoBrokingAnalysis,
  timeslotsDetected: boolean,
  conversationTone: string,
  agentEngagement: string,
  context: ConversationContext,
  shouldContinue: boolean,
  timeslotType?: 'provided' | 'requested'
): Promise<string> {
  try {
    // Analyze conversation patterns to inform response strategy
    const patterns = analyzeConversationPatterns(context);
    
    // Check if both objectives are met using CURRENT AI analysis results (not outdated database values)
  const coBrokingConfirmed = coBrokingAnalysis.status === 'willing' || 
                            coBrokingAnalysis.status === 'needs_discussion' ||
                            patterns.lastCobrokingResponse === 'positive';
  // Only consider timeslots as "received" if they were PROVIDED, not just requested
  const timeslotsReceived = (timeslotsDetected && timeslotType === 'provided') || 
                           context.objectivesStatus?.timeslotsReceived ||
                           patterns.lastTimeslotResponse === 'provided';
  const bothObjectivesMet = coBrokingConfirmed && timeslotsReceived;
  
  // Check if the agent is asking a direct question that needs an answer
  const isDirectQuestion = isDirectPersonalQuestion(context.agentMessage);
  
  // Check if it's a simple acknowledgment when objectives are met
  const isAcknowledgment = isSimpleAcknowledgment(context.agentMessage);
  
  // DEBUG: Log the decision logic with more prominent logging
  console.log('🚨🚨🚨 CRITICAL DEBUG - generateNaturalResponse 🚨🚨🚨');
  console.log('Message:', context.agentMessage);
  console.log('isDirectQuestion result:', isDirectQuestion);
  console.log('isAcknowledgment result:', isAcknowledgment);
  console.log('coBrokingConfirmed:', coBrokingConfirmed);
  console.log('timeslotsReceived:', timeslotsReceived);
  console.log('bothObjectivesMet:', bothObjectivesMet);
  console.log('Final condition (bothObjectivesMet && (!isDirectQuestion || isAcknowledgment)):', bothObjectivesMet && (!isDirectQuestion || isAcknowledgment));
  console.log('🚨🚨🚨 END CRITICAL DEBUG 🚨🚨🚨');
  
  // If both objectives are met, handle responses very carefully
  if (bothObjectivesMet) {
    // If it's a simple acknowledgment (ok, thanks, etc.), NEVER respond - conversation is complete
    if (isAcknowledgment) {
      console.log('✅ Both objectives met + simple acknowledgment - NOT responding');
      return '';
    }
    
    // Check if we've already sent a completion message recently
    // Look at the LAST user message (most recent one we sent)
    const lastUserMessage = context.conversationHistory
      .filter(msg => msg.role === 'user')
      .slice(-1)[0];
    
    const hasRecentCompletion = lastUserMessage && (() => {
      const msgLower = lastUserMessage.message.toLowerCase();
      return msgLower.includes('coordinate with my buyer') ||
             msgLower.includes('get back to you') ||
             msgLower.includes('confirming co-broking') ||
             msgLower.includes('viewing times') ||
             msgLower.includes('thank you for confirming');
    })();
    
    if (hasRecentCompletion) {
      console.log('✅ Both objectives met + completion already sent in last message - NOT responding to:', context.agentMessage);
      return '';
    }
    
    // If it's a direct question that needs an answer, respond briefly
    if (isDirectQuestion) {
      console.log('✅ Both objectives met + direct question - responding briefly');
      const lowerMessage = context.agentMessage.toLowerCase().trim();
      
      // For greetings when objectives are met, just acknowledge briefly
      if (lowerMessage === 'hello' || lowerMessage === 'hi' || lowerMessage === 'hey') {
        return "Hi. Everything is confirmed. I'll coordinate with my buyer and get back to you soon.";
      }
      
      // For bot questions when objectives are met, respond naturally without asking about co-broking
      if (lowerMessage.includes('are you a bot') || lowerMessage.includes('are you ai')) {
        return "I'm Jeremy, a buyer's agent. Everything is confirmed for the viewing. I'll coordinate with my buyer and get back to you soon.";
      }
      
      // For other direct questions, let AI generate a brief response
      // (will continue to AI generation below, but with special handling)
    } else {
      // Not a question, not an acknowledgment - don't respond if completion already sent
      const completionMessage = generateCompletionMessage(context);
      if (!completionMessage) {
        console.log('✅ Both objectives met + completion already sent - NOT responding');
        return '';
      }
      // If we haven't sent completion yet, send it
      console.log('🎯 Sending completion message because both objectives are met');
      return completionMessage;
    }
  }
  
  // IMPORTANT: If we reach here and both objectives are met, we should NOT continue to AI generation
  // This is a safety check to prevent generating responses when objectives are already met
  if (bothObjectivesMet) {
    // Double-check: if it's an acknowledgment, definitely don't respond
    if (isAcknowledgment) {
    console.log('🛑 SAFETY CHECK: Both objectives met + acknowledgment - stopping before AI generation');
    return '';
    }
    
    // Also check if we just sent a completion message
    const lastUserMessage = context.conversationHistory
      .filter(msg => msg.role === 'user')
      .slice(-1)[0];
    
    if (lastUserMessage) {
      const msgLower = lastUserMessage.message.toLowerCase();
      if (msgLower.includes('coordinate with my buyer') ||
          msgLower.includes('get back to you') ||
          msgLower.includes('confirming co-broking') ||
          msgLower.includes('viewing times') ||
          msgLower.includes('thank you for confirming')) {
        console.log('🛑 SAFETY CHECK: Both objectives met + completion just sent - stopping before AI generation');
        return '';
      }
    }
  }
    
    // Use AI generation for ALL responses after the initial message
    // Only the initial message should be a template

    // For follow-up messages, use fully natural AI generation
    // Format conversation history as proper message array for better context understanding
    const conversationMessages = context.conversationHistory.map(msg => ({
      role: msg.role === 'user' ? 'assistant' : 'user', // Flip roles: our messages are 'assistant', theirs are 'user'
      content: msg.message
    }));
    
    // Create natural conversation text from history
    const conversationText = context.conversationHistory
      .map(msg => `${msg.role === 'user' ? 'Jeremy (Buyer Agent)' : 'Property Agent'}: ${msg.message}`)
      .join('\n');

    // Get the active prompt from database - this should always exist now
    const activePrompt = await getActivePrompt();
    
    if (!activePrompt) {
      throw new Error(ERROR_MESSAGES.NO_ACTIVE_PROMPT);
    }
    
    // Get current date/time for context
    const currentDateTime = new Date().toLocaleString('en-SG', { 
      timeZone: 'Asia/Singapore',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    // Replace template variables in the unified prompt
    const responsePrompt = activePrompt
      .replace('{currentDateTime}', currentDateTime)
      .replace('{currentPhase}', context.currentPhase)
      .replace('{daysElapsed}', context.daysElapsed.toString())
      .replace('{coBrokingStatus}', coBrokingAnalysis.status)
      .replace('{timeslotsStatus}', timeslotsReceived ? 'received' : 'needed')
      .replace('{conversationHistory}', conversationText)
      .replace('{agentMessage}', context.agentMessage);

    // Add minimal context hints (not rigid rules)
    const naturalContext = `
CURRENT SITUATION:
- Co-broking status: ${coBrokingAnalysis.status}
- Timeslots: ${timeslotsReceived ? 'Already provided' : 'Not yet provided'}
- Both objectives met: ${bothObjectivesMet ? 'YES - conversation is complete' : 'No'}
- Conversation flow: ${conversationText.split('\n').length} messages exchanged

CRITICAL: ${bothObjectivesMet 
  ? 'BOTH OBJECTIVES ARE ALREADY MET. The conversation is COMPLETE. If they send "Ok", "Thanks", or any simple acknowledgment, do NOT respond at all. Only respond if they ask a direct question that needs an answer, and keep it to 1 sentence maximum. Do NOT ask about co-broking or timeslots again.'
  : 'OBJECTIVES NOT YET MET. Continue working toward the objectives naturally. If they send "Ok", "Sure", or similar acknowledgment, treat it as engagement and respond to continue the conversation. Ask about co-broking or timeslots as appropriate.'}

NATURAL CONVERSATION GUIDANCE:
- Read the full conversation above to understand what's been discussed
- Respond naturally to what the Property Agent just said: "${context.agentMessage}"
- Match their tone - if they're casual, be casual; if formal, be formal
- Don't repeat questions that were already asked
- Build on the conversation naturally, don't restart topics
- ${bothObjectivesMet 
  ? 'DO NOT respond to "Ok" or simple acknowledgments. Only respond to direct questions, and keep it to 1 sentence.' 
  : 'If they send "Ok" or similar acknowledgment, respond to continue the conversation and work toward objectives.'}`;

    const enhancedPrompt = responsePrompt + '\n\n' + naturalContext;

    const client = getGroqClient();
    
    // Build request with natural conversation parameters
    const requestParams: any = {
      messages: [
        {
          role: 'system',
          content: enhancedPrompt,
        },
      ],
      model: AI_CONFIG.MODEL,
      temperature: AI_CONFIG.TEMPERATURE,
      max_tokens: AI_CONFIG.MAX_TOKENS.RESPONSE_GENERATION,
      // Use JSON mode for structured outputs (best practice from OpenAI/Anthropic)
      response_format: { type: "json_object" },
      // Add stop sequences to prevent unwanted continuation
      stop: bothObjectivesMet ? ['"', "'", 'Thank you', 'Thanks'] : undefined,
    };
    
    // Add penalty parameters if available (Groq may support these)
    if (AI_CONFIG.FREQUENCY_PENALTY !== undefined) {
      requestParams.frequency_penalty = AI_CONFIG.FREQUENCY_PENALTY;
    }
    if (AI_CONFIG.PRESENCE_PENALTY !== undefined) {
      requestParams.presence_penalty = AI_CONFIG.PRESENCE_PENALTY;
    }
    
    // Add explicit instruction to return plain strings (not JSON-encoded) in replyMessage
    // This prevents the AI from returning {"replyMessage": "\"Hello\""} instead of {"replyMessage": "Hello"}
    const jsonInstruction = `\n\nCRITICAL JSON FORMATTING: When returning JSON, the "replyMessage" field must be a plain string value, NOT a JSON-encoded string. 
Example CORRECT: {"replyMessage": "Hello there"} 
Example WRONG: {"replyMessage": "\\"Hello there\\""}
Return the message text directly without extra quotes or JSON encoding.`;
    
    requestParams.messages[0].content = requestParams.messages[0].content + jsonInstruction;
    
    const response = await client.chat.completions.create(requestParams);

    // Check finish_reason to understand why generation stopped (best practice)
    const finishReason = response.choices[0]?.finish_reason;
    console.log('📊 AI finish_reason:', finishReason);
    
    // If stopped due to length or other issues, log it
    if (finishReason && finishReason !== 'stop') {
      console.warn('⚠️ AI stopped for reason:', finishReason);
    }

    const aiResponse = response.choices[0]?.message?.content?.trim();
    
    // Parse JSON response from AI (using structured output best practice)
    try {
      const parsedResponse = JSON.parse(aiResponse || '{}');
      
      // Best practice: Check explicit stopping conditions first
      if (parsedResponse.shouldReply === false) {
        console.log('✅ AI explicitly set shouldReply to false - not responding');
        return '';
      }
      
      // Best practice: Validate response structure
      if (!parsedResponse.replyMessage && parsedResponse.shouldReply !== true) {
        console.log('✅ AI response indicates no reply needed - not responding');
        return '';
      }
      
      let replyMessage = parsedResponse.replyMessage;
      
      // If replyMessage is null, empty, or "null" string and shouldReply is false, don't respond
      if ((!replyMessage || replyMessage.trim() === '' || replyMessage === 'null' || replyMessage === null) && parsedResponse.shouldReply === false) {
        console.log('✅ AI set shouldReply to false and replyMessage is empty - not responding');
        return '';
      }
      
      // Best practice: If both objectives met and message is empty/null, don't respond
      if (bothObjectivesMet && (!replyMessage || replyMessage.trim() === '' || replyMessage === 'null' || replyMessage === null)) {
        console.log('✅ Both objectives met and AI returned empty message - not responding');
        return '';
      }
      
      // Aggressively clean up any unwanted quotation marks from the reply message
      if (replyMessage && typeof replyMessage === 'string') {
        const originalMessage = replyMessage;
        
        // First, handle JSON-encoded strings (the AI might return the message as a JSON string)
        // Try to parse it as JSON if it looks like a JSON string
        if (replyMessage.trim().startsWith('"') && replyMessage.trim().endsWith('"')) {
          try {
            const parsed = JSON.parse(replyMessage);
            if (typeof parsed === 'string') {
              replyMessage = parsed;
              console.log('✅ Stripped JSON quotes from replyMessage');
            }
          } catch (e) {
            // Not valid JSON, continue with normal cleaning
          }
        }
        
        // Remove all escaped quotes (both double and single)
        replyMessage = replyMessage.replace(/\\"/g, '"').replace(/\\'/g, "'");
        
        // Remove quotes at the very start and end (handle multiple layers)
        replyMessage = replyMessage.trim();
        
        // Remove leading/trailing quotes (single or double, multiple layers) - more aggressive loop
        let iterations = 0;
        const maxIterations = 10; // Prevent infinite loops
        while (iterations < maxIterations) {
          const before = replyMessage;
          
          // Remove outer quotes if they match
          if ((replyMessage.startsWith('"') && replyMessage.endsWith('"')) ||
              (replyMessage.startsWith("'") && replyMessage.endsWith("'"))) {
          replyMessage = replyMessage.slice(1, -1).trim();
        }
        
          // If no change, break
          if (replyMessage === before) {
            break;
          }
          
          iterations++;
        }
        
        // Remove any remaining quotes at start/end with regex (more aggressive)
        replyMessage = replyMessage.replace(/^["']+/g, '').replace(/["']+$/g, '');
        
        // Remove quotes that wrap the entire message using regex (multiline support)
        const quotePattern = /^["']([\s\S]+)["']$/;
        const match = replyMessage.match(quotePattern);
        if (match) {
          replyMessage = match[1];
        }
        
        // Final trim
        replyMessage = replyMessage.trim();
        
        // If still wrapped in quotes after all cleaning, force remove them one more time
        // Also handle cases where quotes might be at different positions
        while ((replyMessage.startsWith('"') && replyMessage.endsWith('"')) ||
               (replyMessage.startsWith("'") && replyMessage.endsWith("'"))) {
          const before = replyMessage;
          replyMessage = replyMessage.slice(1, -1).trim();
          if (replyMessage === before) break; // Prevent infinite loop
        }
        
        // One more aggressive pass: remove any leading/trailing quote characters
        replyMessage = replyMessage.replace(/^["']+|["']+$/g, '').trim();
        
        // Log if we actually cleaned something
        if (originalMessage !== replyMessage) {
          console.log('🧹 Cleaned quotes from replyMessage:', {
            before: originalMessage.substring(0, 100),
            after: replyMessage.substring(0, 100)
          });
        }
      }
      
      // Return the cleaned message content
      // If replyMessage is empty/null, return empty string (don't use fallback)
      // The calling code should handle empty responses appropriately
      return replyMessage || '';
    } catch (parseError) {
      console.warn('⚠️ Failed to parse AI JSON response, using raw response:', parseError);
      console.warn('Raw AI response:', aiResponse);
      
      // If JSON parsing fails, use the raw response but clean up any surrounding quotes
      // Don't use fallback message - return empty if no valid response
      let cleanResponse = aiResponse || '';
      
      // Aggressively clean up quotes from raw responses
      if (cleanResponse && typeof cleanResponse === 'string') {
        // Remove all escaped quotes first
        cleanResponse = cleanResponse.replace(/\\"/g, '"').replace(/\\'/g, "'");
        
        // Remove quotes at the very start and end (handle multiple quotes)
        cleanResponse = cleanResponse.trim();
        
        // Remove leading quotes (single or double, multiple)
        while ((cleanResponse.startsWith('"') || cleanResponse.startsWith("'")) && 
               (cleanResponse.endsWith('"') || cleanResponse.endsWith("'"))) {
          cleanResponse = cleanResponse.slice(1, -1).trim();
        }
        
        // Remove any remaining quotes at start/end with regex
        cleanResponse = cleanResponse.replace(/^["']+/g, '').replace(/["']+$/g, '');
        
        // Remove quotes that wrap the entire message
        const quotePattern = /^["'](.+)["']$/;
        const match = cleanResponse.match(quotePattern);
        if (match) {
          cleanResponse = match[1];
        }
        
        // Final trim
        cleanResponse = cleanResponse.trim();
      }
      
      return cleanResponse;
    }
  } catch (error: unknown) {
    console.error('❌ Error generating natural response:', error);
    
    // Generic fallback when AI fails - avoid hardcoded templates
    // Don't return a generic fallback - let the calling code handle empty responses
    return '';
  }
}

// Removed template function - all responses after initial message are AI-generated

function generateContextualResponse(
  coBrokingAnalysis: CoBrokingAnalysis,
  timeslotsDetected: boolean,
  conversationTone: string,
  agentEngagement: string,
  context: ConversationContext
): string {
  // Let the AI generate natural responses instead of using templates
  // This will be handled by the AI prompt system for more natural conversation flow
  return "";
}

/**
 * Analyze conversation history to detect repetitive patterns and avoid asking the same questions
 */
function analyzeConversationPatterns(context: ConversationContext): {
  hasAskedAboutCobroking: boolean;
  hasAskedAboutTimeslots: boolean;
  lastCobrokingResponse: 'positive' | 'negative' | 'neutral' | null;
  lastTimeslotResponse: 'provided' | 'declined' | 'neutral' | null;
  recentQuestionCount: number;
} {
  const history = context.conversationHistory;
  let hasAskedAboutCobroking = false;
  let hasAskedAboutTimeslots = false;
  let lastCobrokingResponse: 'positive' | 'negative' | 'neutral' | null = null;
  let lastTimeslotResponse: 'provided' | 'declined' | 'neutral' | null = null;
  let recentQuestionCount = 0;

  // Analyze last 10 messages for patterns (increased from 6 to catch more context)
  const recentMessages = history.slice(-10);
  
  for (let i = 0; i < recentMessages.length; i++) {
    const msg = recentMessages[i];
    const msgLower = msg.message.toLowerCase();
    
    // Count questions from Jeremy (user role)
    if (msg.role === 'user' && msgLower.includes('?')) {
      recentQuestionCount++;
    }
    
    // Check if Jeremy has asked about co-broking OR if agent has mentioned co-broking willingness
    if ((msg.role === 'user' && (
      msgLower.includes('co-brok') || 
      msgLower.includes('cobrok') ||
      msgLower.includes('commission') ||
      msgLower.includes('work together') ||
      msgLower.includes('collaborate')
    )) || (msg.role === 'agent' && (
      msgLower.includes('co-brok') || 
      msgLower.includes('cobrok') ||
      msgLower.includes('happy to work') ||
      msgLower.includes('open to co') ||
      msgLower.includes('willing to co') ||
      msgLower.includes('work together')
    ))) {
      hasAskedAboutCobroking = true;
      
      // If this is a user question, check the agent's response
      if (msg.role === 'user' && i + 1 < recentMessages.length) {
        const response = recentMessages[i + 1];
        if (response.role === 'agent') {
          const responseLower = response.message.toLowerCase();
          if (responseLower.includes('yes') || responseLower.includes('sure') || responseLower.includes('open') || 
              responseLower.includes('happy to') || responseLower.includes('willing')) {
            lastCobrokingResponse = 'positive';
          } else if (responseLower.includes('no') || responseLower.includes('not') || responseLower.includes('can\'t')) {
            lastCobrokingResponse = 'negative';
          } else {
            lastCobrokingResponse = 'neutral';
          }
        }
      }
      // If this is an agent message expressing willingness, mark as positive
      else if (msg.role === 'agent') {
        if (msgLower.includes('happy to') || msgLower.includes('open to') || 
            msgLower.includes('willing to') || msgLower.includes('yes') ||
            msgLower.includes('sure') || msgLower.includes('absolutely')) {
          lastCobrokingResponse = 'positive';
        } else if (msgLower.includes('no') || msgLower.includes('not interested') || 
                   msgLower.includes('can\'t') || msgLower.includes('unable')) {
          lastCobrokingResponse = 'negative';
        }
      }
    }
    
    // Check if Jeremy has asked about timeslots/viewing times OR if agent provided timeslots
    // IMPORTANT: If agent provides timeslots, it implies co-broking agreement
    if ((msg.role === 'user' && (
      msgLower.includes('time') || 
      msgLower.includes('when') ||
      msgLower.includes('viewing') ||
      msgLower.includes('meet') ||
      msgLower.includes('available') ||
      msgLower.includes('schedule')
    )) || (msg.role === 'agent' && (
      // Agent providing timeslots (like "Mon to Wed 5pm to 9pm") implies co-broking
      (msgLower.match(/(mon|tue|wed|thu|fri|sat|sun)/i) && msgLower.match(/\d+\s*(am|pm|:\d+)/i)) ||
      msgLower.includes('available') && (msgLower.includes('pm') || msgLower.includes('am'))
    ))) {
      hasAskedAboutTimeslots = true;
      
      // If agent provided timeslots directly (not in response to a question), it implies co-broking
      if (msg.role === 'agent') {
        if (msgLower.match(/\d+[:\.]?\d*\s*(am|pm|morning|afternoon|evening)/i) ||
            msgLower.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i) ||
            (msgLower.match(/(mon|tue|wed|thu|fri|sat|sun)/i) && msgLower.match(/\d+\s*(am|pm|:\d+)/i))) {
          lastTimeslotResponse = 'provided';
          // IMPORTANT: Providing timeslots implies co-broking agreement
          if (!lastCobrokingResponse || lastCobrokingResponse === 'neutral') {
            lastCobrokingResponse = 'positive';
          }
        }
      }
      
      // Check the agent's response to timeslot question
      if (i + 1 < recentMessages.length) {
        const response = recentMessages[i + 1];
        if (response.role === 'agent') {
          const responseLower = response.message.toLowerCase();
          // Check if they provided specific times
          if (responseLower.match(/\d+[:\.]?\d*\s*(am|pm|morning|afternoon|evening)/i) ||
              responseLower.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)) {
            lastTimeslotResponse = 'provided';
            // IMPORTANT: Providing timeslots implies co-broking agreement
            if (!lastCobrokingResponse || lastCobrokingResponse === 'neutral') {
              lastCobrokingResponse = 'positive';
            }
          } else if (responseLower.includes('busy') || responseLower.includes('can\'t') || responseLower.includes('not available')) {
            lastTimeslotResponse = 'declined';
          } else {
            lastTimeslotResponse = 'neutral';
          }
        }
      }
    }
  }

  return {
    hasAskedAboutCobroking,
    hasAskedAboutTimeslots,
    lastCobrokingResponse,
    lastTimeslotResponse,
    recentQuestionCount
  };
}

/**
 * Determine if conversation should continue
 * Uses pattern analysis to make smarter decisions and avoid repetitive questions
 */
function determineConversationContinuation(
  coBrokingAnalysis: CoBrokingAnalysis,
  timeslotsDetected: boolean,
  context: ConversationContext
): boolean {
  // Check if the agent is asking a direct personal question that needs an answer
  const isDirectQuestion = isDirectPersonalQuestion(context.agentMessage);
  
  // Always respond to direct personal questions
  if (isDirectQuestion) {
    return true;
  }
  
  // Analyze conversation patterns to avoid repetitive questions
  const patterns = analyzeConversationPatterns(context);
  
  // If too many questions asked recently (more than 2 in last 10 messages), be more cautious
  if (patterns.recentQuestionCount > 2) {
    return false; // Avoiding being pushy
  }

  // DEALBREAKER: Don't continue if agent is not willing to co-broke
  if (coBrokingAnalysis.status === 'not_willing' || patterns.lastCobrokingResponse === 'negative') {
    return false;
  }
  
  // If conversation has been going on for too long (more than 5 days), be more selective
  if (context.daysElapsed > 5) {
    // Only continue if we haven't achieved either objective yet
    if (coBrokingAnalysis.status === 'unknown' && !timeslotsDetected) {
      return true; // Long conversation but no progress on objectives
    }
    return false; // Conversation has gone on too long
  }
  
  // COMPLETION CHECK: If both objectives are met using CURRENT AI analysis results
  const coBrokingConfirmed = coBrokingAnalysis.status === 'willing' || 
                            coBrokingAnalysis.status === 'needs_discussion' ||
                            patterns.lastCobrokingResponse === 'positive';
  const timeslotsReceived = timeslotsDetected || 
                           context.objectivesStatus?.timeslotsReceived ||
                           patterns.lastTimeslotResponse === 'provided';
  
  if (coBrokingConfirmed && timeslotsReceived) {
    return false; // Both objectives achieved
  }
  
  // Smart continuation logic based on what we've already established
  if (patterns.lastCobrokingResponse === 'positive' || coBrokingAnalysis.status === 'willing') {
    // Co-broking is confirmed, now focus on timeslots if not received
    if (!timeslotsReceived && !patterns.hasAskedAboutTimeslots) {
      return true; // Need to ask about timeslots
    } else if (!timeslotsReceived && patterns.lastTimeslotResponse === 'declined') {
      return false; // Agent declined to provide timeslots
    } else if (timeslotsReceived) {
      return false; // Both objectives met, don't continue
    }
  }

  // If we haven't established co-broking status yet, that's the priority
  if (!patterns.hasAskedAboutCobroking && coBrokingAnalysis.status === 'unknown' && patterns.lastCobrokingResponse === null) {
    return true; // Need to ask about co-broking
  }

  // If co-broking is unclear and we haven't asked about timeslots, try that approach
  if (coBrokingAnalysis.status === 'unknown' && patterns.lastCobrokingResponse === null && !patterns.hasAskedAboutTimeslots && !timeslotsReceived) {
    return true; // Try asking about timeslots
  }
  
  // Continue only if we genuinely need information and haven't been repetitive
  const needsCoBroking = coBrokingAnalysis.status === 'unknown' && patterns.lastCobrokingResponse === null;
  const needsTimeslots = !timeslotsReceived && patterns.lastTimeslotResponse !== 'provided';
  
  return (needsCoBroking || needsTimeslots) && patterns.recentQuestionCount <= 1;
}
