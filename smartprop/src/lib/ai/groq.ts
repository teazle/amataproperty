/**
 * Groq AI Integration for Viewing Timeslot Parsing
 * Uses Groq's free tier with fast inference
 * Docs: https://console.groq.com/docs
 */

import Groq from 'groq-sdk';

// Lazy initialization to avoid errors when env var not loaded yet
let groq: Groq | null = null;

function getGroqClient(): Groq {
  if (!groq) {
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }
  return groq;
}

export interface ParsedTimeslot {
  day?: string;
  date?: string;
  time?: string;
  formatted?: string;
}

export interface ParsedViewingSlots {
  available: boolean;
  slots: ParsedTimeslot[];
  notes?: string;
  raw_text: string;
}

/**
 * Parse viewing timeslots from agent reply using Groq AI
 * @param replyText - Agent's reply text
 * @returns Structured viewing timeslots or null if parsing fails
 */
export async function parseViewingTimeslotsWithAI(
  replyText: string
): Promise<ParsedViewingSlots | null> {
  if (!replyText || !process.env.GROQ_API_KEY) {
    return null;
  }

  try {
    // Get current date and time context in Singapore timezone
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
    const currentDay = now.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', weekday: 'long' });
    
    // Calculate tomorrow's date for reference
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowDate = tomorrow.toLocaleDateString('en-SG', { 
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const tomorrowDay = tomorrow.toLocaleDateString('en-SG', { 
      timeZone: 'Asia/Singapore',
      weekday: 'long'
    });
    
    const client = getGroqClient();
    const completion = await client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant that extracts viewing timeslot information from property agent messages.

CURRENT DATE & TIME CONTEXT:
📅 Today is: ${currentDateTime}
📆 Current day: ${currentDay}
📅 Tomorrow is: ${tomorrowDay}, ${tomorrowDate}
🕐 Singapore Time Zone (Asia/Singapore)

Extract all viewing timeslots and return ONLY valid JSON with this structure:
{
  "available": true/false,
  "slots": [
    {
      "day": "Monday" (actual day name, not "Today" or "Tomorrow"),
      "date": "2025-10-13" (ISO format - ALWAYS convert relative dates to absolute),
      "time": "6pm" or "9am-6pm" or "afternoon",
      "formatted": "Monday, Oct 13 6pm" (human readable with actual date)
    }
  ],
  "notes": "any additional notes from agent"
}

CRITICAL: Convert relative dates to absolute dates using Singapore timezone:
- "Today" → ${currentDay} (${currentDateTime.split(',')[0]})
- "Tomorrow" → ${tomorrowDay} (${tomorrowDate})
- "Wednesday" → If today is Tuesday, Wednesday = tomorrow. If today is Monday, Wednesday = day after tomorrow
- "Thursday" → If today is Wednesday, Thursday = tomorrow. If today is Tuesday, Thursday = day after tomorrow
- Always include the actual date in ISO format (YYYY-MM-DD) and correct day name
- Double-check your date calculations against the current context above

If no timeslots are available or message is unclear, return:
{
  "available": false,
  "slots": [],
  "notes": "brief explanation"
}

Return ONLY the JSON, no markdown, no explanation.`,
        },
        {
          role: 'user',
          content: `Parse this agent reply for viewing timeslots:\n\n"${replyText}"`,
        },
      ],
      model: 'llama-3.3-70b-versatile', // Better context understanding
      temperature: 0.1, // Low temperature for consistent parsing
      max_tokens: 500,
      response_format: { type: 'json_object' }, // Force JSON output
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      console.log('⚠️  Groq returned empty response');
      return null;
    }

    const parsed = JSON.parse(responseText) as ParsedViewingSlots;
    
    // Add raw text for reference
    parsed.raw_text = replyText;
    
    console.log('✅ AI parsed viewing slots:', JSON.stringify(parsed, null, 2));
    
    return parsed;
  } catch (error) {
    console.error('❌ Error parsing with Groq AI:', error);
    return null;
  }
}

/**
 * Format parsed timeslots into human-readable text
 * @param parsed - Parsed viewing slots
 * @returns Formatted string
 */
export function formatParsedTimeslots(parsed: ParsedViewingSlots): string {
  if (!parsed.available || parsed.slots.length === 0) {
    return parsed.notes || 'No viewing slots available';
  }

  const dayOrder = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const orderIndex = new Map(dayOrder.map((day, index) => [day.toLowerCase(), index]));
  const dayRegex = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i;
  const timeRegex = /\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm))?/i;

  const grouped = new Map<string, { time: string; days: string[] }>();

  for (const slot of parsed.slots) {
    let day = slot.day?.trim();
    let time = slot.time?.trim();
    const formatted = slot.formatted || '';

    if (!day && formatted) {
      const dayMatch = formatted.match(dayRegex);
      if (dayMatch) {
        day = dayMatch[0];
      }
    }

    if (!time && formatted) {
      const timeMatch = formatted.match(timeRegex);
      if (timeMatch) {
        time = timeMatch[0];
      }
    }

    if (time) {
      time = time.replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').trim();
    }

    day = day || 'Any day';
    time = time || 'Any time';

    const key = time.toLowerCase();
    const entry = grouped.get(key);
    if (entry) {
      if (!entry.days.some(d => d.toLowerCase() === day!.toLowerCase())) {
        entry.days.push(day);
      }
    } else {
      grouped.set(key, { time, days: [day] });
    }
  }

  const summarizeDays = (days: string[]) => {
    if (!days.length) return '';
    const uniqueDays = [...new Set(days)]
      .map(day => dayOrder.find(d => d.toLowerCase() === day.toLowerCase()) || day)
      .sort((a, b) => (orderIndex.get(a.toLowerCase()) ?? 99) - (orderIndex.get(b.toLowerCase()) ?? 99));

    const ranges: string[] = [];
    let start = uniqueDays[0];
    let prev = uniqueDays[0];

    const flush = (end: string) => {
      if (!start) return;
      const startIndex = orderIndex.get(start.toLowerCase()) ?? 0;
      const endIndex = orderIndex.get(end.toLowerCase()) ?? startIndex;
      if (endIndex - startIndex >= 2) {
        ranges.push(`${start} to ${end}`);
      } else if (endIndex - startIndex === 1) {
        ranges.push(`${start} & ${end}`);
      } else {
        ranges.push(start);
      }
    };

    for (let i = 1; i < uniqueDays.length; i++) {
      const current = uniqueDays[i];
      const prevIndex = orderIndex.get(prev.toLowerCase()) ?? -10;
      const currentIndex = orderIndex.get(current.toLowerCase()) ?? -10;
      if (currentIndex - prevIndex === 1) {
        prev = current;
        continue;
      }
      flush(prev);
      start = current;
      prev = current;
    }

    flush(prev);

    if (ranges.length === 1) return ranges[0];
    if (ranges.length === 2) return `${ranges[0]} & ${ranges[1]}`;
    return `${ranges.slice(0, -1).join(', ')}, and ${ranges[ranges.length - 1]}`;
  };

  const phrases: string[] = [];
  for (const { time, days } of grouped.values()) {
    const dayPhrase = summarizeDays(days);
    if (dayPhrase && time) {
      phrases.push(`${dayPhrase}, ${time}`);
    } else if (dayPhrase) {
      phrases.push(dayPhrase);
    } else if (time) {
      phrases.push(time);
    }
  }

  if (phrases.length) {
    if (phrases.length === 1) return phrases[0];
    if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
    return `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
  }

  // Format each slot with absolute date (not "Tomorrow")
  const formattedSlots = parsed.slots.map(slot => {
    const parts = [];
    
    // If we have an actual date, format it nicely
    if (slot.date) {
      const date = new Date(slot.date);
      // Format: "Mon, Oct 13"
      const dateStr = date.toLocaleDateString('en-SG', { 
        weekday: 'short',
        month: 'short', 
        day: 'numeric',
        timeZone: 'Asia/Singapore'
      });
      parts.push(dateStr);
    } else if (slot.day) {
      // Fallback to day name if no date
      parts.push(slot.day);
    }
    
    // Add time
    if (slot.time) {
      parts.push(slot.time);
    }
    
    return parts.join(' ');
  });
  
  // Join multiple slots naturally
  let result = formattedSlots.length > 1 
    ? formattedSlots.join(', ') 
    : formattedSlots[0];
  
  // Add notes if relevant
  if (parsed.notes && parsed.notes !== 'No specific timeslots provided') {
    result += ` (${parsed.notes})`;
  }
  
  return result;
}
