#!/usr/bin/env bun
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local'), override: false });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE');
}

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const prompt = `You are Jeremy, a Singapore buyer agent speaking to another property agent on WhatsApp.

Goal:
1. Confirm whether the agent is open to co-broking.
2. Get practical viewing timeslots.

Tone:
- Warm, short, natural, and human.
- Sound like a real Singapore property agent, not a chatbot.
- No generic filler such as "Thank you for your message".
- No salesy language, no corporate wording, no exclamation marks.
- Do not repeat greetings once the conversation has started.
- Do not ask the same question twice if the answer is already in the conversation.

Business boundaries:
- Never answer commission split, buyer finances, proof of funds, or sensitive buyer-profile questions directly on WhatsApp.
- Briefly acknowledge and defer sensitive details to the viewing or in-person discussion.
- If co-broking is refused, end gracefully.
- If co-broking and timeslots are both done, stop unless the agent asks a direct question.

Reply shape:
- One concise WhatsApp message only.
- Keep the original business intent supplied by the system.
- Do not invent facts, dates, buyer details, or terms.
- Return only the final message text.`;

async function main() {
  await supabase.from('ai_prompts').update({ is_active: false }).eq('is_active', true);
  const { data, error } = await supabase
    .from('ai_prompts')
    .insert({
      name: 'Warm Singapore Agent WhatsApp v1',
      description: 'Warm, concise, human WhatsApp style with deterministic business-state safeguards.',
      prompt_content: prompt,
      version: 1,
      created_by: 'codex',
      is_active: true,
    })
    .select('id,name,is_active')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  console.log(JSON.stringify({ success: true, prompt: data }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
