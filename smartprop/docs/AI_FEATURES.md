# 🤖 AI Features & Automation

Complete guide to all AI-powered features in SmartProp.

---

## Table of Contents

1. [Groq AI Setup](#groq-ai-setup)
2. [Viewing Timeslot Parsing](#viewing-timeslot-parsing)
3. [Human-Like Behavior](#human-like-behavior)
4. [Natural Message Formatting](#natural-message-formatting)
5. [Troubleshooting](#troubleshooting)

---

## Groq AI Setup

### Why Groq?

- ✅ **100% FREE** (generous free tier)
- ✅ **Super Fast** (fastest AI inference available)
- ✅ **14,400 requests/day** (more than enough)
- ✅ **No credit card required**
- ✅ **OpenAI-compatible API**

### Quick Setup (2 minutes)

**Step 1: Get Free Groq API Key**

1. Go to **https://console.groq.com/keys**
2. Click **"Sign Up"** (GitHub/Google login available)
3. Click **"Create API Key"**
4. **Copy** the API key (starts with `gsk_...`)

**Step 2: Add to Your .env File**

```bash
# Add this line to your .env file
GROQ_API_KEY=gsk_your_actual_key_here
```

Or run this command:
```bash
echo "GROQ_API_KEY=gsk_your_actual_key_here" >> .env
```

**Step 3: Restart Next.js Server**

```bash
# Kill existing server
pkill -f "next dev"

# Start again
npm run dev
```

✅ **Done!** AI parsing is now active!

### Usage Limits

**Groq Free Tier:**
- ✅ 30 requests per minute
- ✅ 14,400 requests per day
- ✅ No credit card required
- ✅ No expiration

**Your Expected Usage:**
- ~10-50 messages per day
- 🎉 **You'll never hit the limit!**

---

## Viewing Timeslot Parsing

### What It Does

Automatically extracts and structures viewing timeslots from agent messages.

**BEFORE (Simple Parser):**
```
"Sure thing....Monday to Friday 9am to 9pm"
```

**AFTER (AI Parser):**
```json
{
  "available": true,
  "slots": [
    { "day": "Monday", "date": "2025-01-13", "time": "9am-9pm" },
    { "day": "Tuesday", "date": "2025-01-14", "time": "9am-9pm" },
    { "day": "Wednesday", "date": "2025-01-15", "time": "9am-9pm" },
    { "day": "Thursday", "date": "2025-01-16", "time": "9am-9pm" },
    { "day": "Friday", "date": "2025-01-17", "time": "9am-9pm" }
  ],
  "notes": null
}
```

**Formatted for Display:**
```
Mon, Jan 13 9am-9pm, Tue, Jan 14 9am-9pm, Wed, Jan 15 9am-9pm, 
Thu, Jan 16 9am-9pm, Fri, Jan 17 9am-9pm
```

### Features

✅ Extracts individual days from "Monday to Friday"
✅ Parses various time formats (9am, 3:00pm, morning, evening)
✅ Handles dates (10/15, tomorrow, next Monday)
✅ Converts "tomorrow" to actual ISO dates (Singapore timezone)
✅ Detects availability (yes/no)
✅ Extracts additional notes
✅ Returns structured JSON for queries
✅ Automatic fallback to simple parser if AI fails

### Database Storage

**Two fields stored:**
1. `viewing_timeslots` (TEXT) - Human-readable formatted text
2. `viewing_timeslots_structured` (JSONB) - Structured data for queries

**Example Query:**
```sql
-- Find Monday viewings
SELECT title, viewing_timeslots
FROM listings
WHERE viewing_timeslots_structured @> '{"slots": [{"day": "Monday"}]}'::jsonb;
```

---

## Human-Like Behavior

### Overview

The AI chatbot feels natural and human-like with:
- ⌨️ **Typing indicators** ("composing" status shown to agent)
- ⏱️ **Realistic typing delays** (based on message length)
- 🎭 **Response variations** (multiple phrasings for same intent)
- 🧠 **Context-aware timing** (adjusts delay based on conversation phase)

### Typing Delays

**Formula:** `delay = (characters × 25ms) + thinking_pause`

**Timing ranges:**
- **Minimum:** 500ms (never instant)
- **Maximum:** 3000ms (never too slow)
- **Average human typing speed:** 20-25ms per character

**Example delays:**
| Message Length | Thinking Pause | Typing Time | Total Delay |
|----------------|----------------|-------------|-------------|
| 40 chars | 400ms | 1000ms | 1.4s |
| 80 chars | 600ms | 2000ms | 2.6s |
| 120 chars | 800ms | 3000ms (capped) | 3.8s |

### Context-Aware Timing

| Context | Thinking Pause | Reasoning |
|---------|---------------|-----------|
| Agent checking with owner | 300-600ms | Quick acknowledgment |
| Multiple deflections (2+) | 600-1000ms | Thoughtful response |
| Agent asks question | 400-800ms | Natural response time |
| First reply | 500-900ms | Reading their message |
| Long agent message (>100 chars) | +300-600ms | Reading time |

### Response Variations

Instead of repeating the same phrases, the AI randomly selects from variations:

**Example: Ask for availability + co-broke**
- "I'm available Mon-Fri 8-10pm. What times THIS WEEK work for you? Can you co broke?"
- "I can bring my client Mon-Fri 8-10pm. When THIS WEEK suits you? Do you co broke?"
- "My availability is Mon-Fri 8-10pm. Which days THIS WEEK are good for you? Can you co broke?"
- "I'm free Mon-Fri 8-10pm. What times THIS WEEK work for you? Are you open to co-broking?"

### Configuration

**Enable/Disable in `.env`:**
```bash
# Enable human-like typing behavior
ENABLE_TYPING_SIMULATION=true

# Disable for instant replies (testing/debugging)
ENABLE_TYPING_SIMULATION=false
```

**Timing Configuration** (in `src/lib/ai/human-behavior.ts`):
```typescript
const DEFAULT_CONFIG = {
  minDelay: 500,              // Minimum delay (ms)
  maxDelay: 3000,             // Maximum delay (ms)
  msPerCharacter: 25,         // Typing speed (ms per character)
  thinkingPauseMin: 300,      // Min thinking pause (ms)
  thinkingPauseMax: 800,      // Max thinking pause (ms)
};
```

---

## Natural Message Formatting

### Changes Made

**Removed Robotic Formatting:**

**BEFORE (Robotic):**
```
Available slots:
• Monday 3pm
• Tuesday afternoon
• Friday morning
```

**AFTER (Natural):**
```
Monday 3pm, Tuesday afternoon, Friday morning
```

**Single slot:**
```
Monday 3pm
```

**With notes:**
```
Monday 3pm (Agent prefers morning)
```

### Message Principles

All messages are:
- ✅ Graceful and respectful
- ✅ Professional (not robotic)
- ✅ Natural language (no bullets, no caps)
- ✅ Brief and to the point
- ✅ Not pushy or aggressive
- ✅ Includes typing indicators (human-like)

---

## Troubleshooting

### AI parsing not working?

1. **Check API key is set:**
   ```bash
   cat .env | grep GROQ_API_KEY
   ```

2. **Test API key:**
   ```bash
   curl https://api.groq.com/openai/v1/models \
     -H "Authorization: Bearer $GROQ_API_KEY"
   ```

3. **Check Next.js logs:**
   ```bash
   tail -f /tmp/nextjs-dev.log | grep "AI\|Groq"
   ```

### Typing indicator not showing

**Check:**
1. ✅ `ENABLE_TYPING_SIMULATION=true` in `.env`
2. ✅ WAHA is running: `docker compose ps`
3. ✅ Next.js server restarted after `.env` change
4. ✅ WAHA URL is correct in `.env`: `WAHA_URL=http://localhost:3030`

**Test presence API manually:**
```bash
curl -X POST http://localhost:3030/api/default/presence \
  -H "Content-Type: application/json" \
  -d '{"chatId":"6591051399@c.us","presence":"composing"}'
```

### Delays too long/short

**Adjust in `src/lib/ai/human-behavior.ts`:**
```typescript
const DEFAULT_CONFIG = {
  minDelay: 500,    // Increase for slower
  maxDelay: 3000,   // Decrease for faster
  msPerCharacter: 25, // Lower = faster typing
};
```

---

## Model & API Details

**Model Used:** `llama-3.3-70b-versatile`
- Very capable at structured extraction
- Fast inference (~1-2 seconds)
- Excellent at following JSON format instructions
- Free tier included

**Resources:**
- **Groq Console**: https://console.groq.com
- **Groq Docs**: https://console.groq.com/docs
- **API Reference**: https://console.groq.com/docs/api-reference
- **Supported Models**: https://console.groq.com/docs/models

---

**AI features are ready! Get your free Groq API key to activate! 🚀**

