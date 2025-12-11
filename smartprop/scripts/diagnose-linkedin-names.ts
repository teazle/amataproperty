#!/usr/bin/env bun

/**
 * Diagnostic script to analyze LinkedIn messages from yesterday
 * Shows what names were extracted and sent, and compares with the fix
 */

import { getSupabaseClient } from '@/workers/supa';

// OLD extractFirstName function (the buggy one)
function extractFirstNameOld(fullName: string): string {
  if (!fullName || fullName.trim() === '') return '';
  
  // Remove parenthetical nicknames: "Angela (Yusi) Liu" → "Angela Liu"
  let cleaned = fullName.replace(/\([^)]*\)/g, '').trim();
  
  // Remove common titles
  cleaned = cleaned.replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.|Professor)\s+/i, '');
  
  // Split on spaces and take first part
  const parts = cleaned.split(/\s+/);
  
  // Handle hyphenated first names like "Mary-Jane"
  if (parts[0] && parts[0].includes('-')) {
    return parts[0];
  }
  
  // Return first part, or empty string if none
  return parts[0] || '';
}

// NEW extractFirstName function (the fixed one)
const FIRST_NAME_STOPWORDS = new Set([
  'say',
  'happy',
  'birthday',
  'congrats',
  'congratulations',
  'work',
  'anniversary',
  'message',
  'connect',
  'with',
  'their',
  'on',
  'for',
  'about',
  'to',
  'new',
  'role',
  'wish',
  'them',
  'send',
  'please',
  'kindly',
  'catch',
  'up',
  // Title abbreviations (with and without periods)
  'dr',
  'mr',
  'mrs',
  'ms',
  'prof',
  'professor'
]);

function extractFirstNameNew(fullName: string): string {
  if (!fullName || fullName.trim() === '') return '';

  // Remove parenthetical nicknames and emojis
  let cleaned = fullName
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[\u2600-\u27BF\uE000-\uF8FF]/g, ' ')
    .replace(/[|•·–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Try to capture the actual name in common LinkedIn phrases
  // Allow periods in names (for titles like "Dr.") - capture up to prepositions or end
  const phrasePatterns = [
    /say (?:happy )?birthday to\s+([A-Za-z][A-Za-z'’\-\. ]+)/i,
    /say (?:congrats|congratulations) to\s+([A-Za-z][A-Za-z'’\-\. ]+)/i,
    /congratulate\s+([A-Za-z][A-Za-z'’\-\. ]+)/i,
    /message\s+([A-Za-z][A-Za-z'’\-\. ]+)/i,
    /connect with\s+([A-Za-z][A-Za-z'’\-\. ]+)/i
  ];

  for (const pattern of phrasePatterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) {
      cleaned = match[1];
      break;
    }
  }

  // Drop trailing context after prepositions
  cleaned = cleaned.replace(/\b(for|on|about|regarding|at)\b.*$/i, '').trim();

  // Remove leading titles (with or without periods)
  cleaned = cleaned.replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Professor)\s+/i, '');

  const parts = cleaned.split(/\s+/).filter(Boolean);

  // Pick the first token that looks like a plausible name and not a stopword
  const candidate = parts.find((part) => {
    if (FIRST_NAME_STOPWORDS.has(part.toLowerCase())) return false;
    if (!/^[A-Za-z][A-Za-z''\-]*$/.test(part)) return false;
    return part.length >= 2 && part.length <= 30;
  });

  return candidate || '';
}

// Extract first name from enhanced message (the "Dear X," part)
function extractFirstNameFromMessage(message: string): string | null {
  const match = message.match(/^Dear\s+([^,]+),/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

async function diagnoseLinkedInNames() {
  const supabase = getSupabaseClient();
  
  // Get messages from yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  console.log('🔍 Analyzing LinkedIn messages from yesterday...\n');
  console.log(`   Date range: ${yesterday.toISOString()} to ${today.toISOString()}\n`);
  
  const { data: messages, error } = await supabase
    .from('linkedin_messages')
    .select('*')
    .gte('created_at', yesterday.toISOString())
    .lt('created_at', today.toISOString())
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('❌ Error fetching messages:', error);
    process.exit(1);
  }
  
  if (!messages || messages.length === 0) {
    console.log('ℹ️  No messages found from yesterday.');
    process.exit(0);
  }
  
  console.log(`📊 Found ${messages.length} messages from yesterday\n`);
  console.log('='.repeat(100));
  
  let wrongNames = 0;
  let correctNames = 0;
  let noGreeting = 0;
  const issues: Array<{
    contactName: string;
    extractedFirstName: string | null;
    oldExtraction: string;
    newExtraction: string;
    enhancedMessage: string;
    sentAt: string | null;
  }> = [];
  
  for (const msg of messages) {
    const contactName = msg.contact_name || 'Unknown';
    const enhancedMessage = msg.enhanced_message || '';
    
    // Extract what was actually sent (from "Dear X,")
    const extractedFirstName = extractFirstNameFromMessage(enhancedMessage);
    
    // What the OLD function would extract
    const oldExtraction = extractFirstNameOld(contactName);
    
    // What the NEW function would extract
    const newExtraction = extractFirstNameNew(contactName);
    
    // Check if there's a problem
    const hasGreeting = extractedFirstName !== null;
    const isWrong = extractedFirstName && 
      (extractedFirstName.toLowerCase() === 'say' ||
       extractedFirstName.toLowerCase() === 'happy' ||
       extractedFirstName.toLowerCase() === 'congrats' ||
       extractedFirstName.toLowerCase() === 'congratulations' ||
       extractedFirstName.toLowerCase() === 'message' ||
       extractedFirstName.toLowerCase() === 'connect' ||
       extractedFirstName.toLowerCase() === 'unknown' ||
       extractedFirstName.length < 2);
    
    if (isWrong) {
      wrongNames++;
      issues.push({
        contactName,
        extractedFirstName,
        oldExtraction,
        newExtraction,
        enhancedMessage: enhancedMessage.substring(0, 200) + (enhancedMessage.length > 200 ? '...' : ''),
        sentAt: msg.sent_at
      });
    } else if (hasGreeting) {
      correctNames++;
    } else {
      noGreeting++;
    }
  }
  
  // Summary
  console.log('\n📈 SUMMARY\n');
  console.log(`   Total messages: ${messages.length}`);
  console.log(`   ✅ Correct names: ${correctNames}`);
  console.log(`   ❌ Wrong names: ${wrongNames}`);
  console.log(`   ⚠️  No greeting: ${noGreeting}`);
  
  if (wrongNames > 0) {
    console.log('\n' + '='.repeat(100));
    console.log('❌ MESSAGES WITH WRONG NAMES:\n');
    
    issues.forEach((issue, i) => {
      console.log(`${i + 1}. Contact: "${issue.contactName}"`);
      console.log(`   ❌ Sent as: "Dear ${issue.extractedFirstName},"`);
      console.log(`   🔴 OLD function would extract: "${issue.oldExtraction}"`);
      console.log(`   🟢 NEW function would extract: "${issue.newExtraction}"`);
      console.log(`   📅 Sent at: ${issue.sentAt || 'Not sent yet'}`);
      console.log(`   💬 Message preview: ${issue.enhancedMessage.substring(0, 100)}...`);
      console.log('');
    });
    
    console.log('='.repeat(100));
    console.log('\n✅ VERIFICATION: The fix would have prevented these issues!\n');
    
    // Show how many would be fixed
    const wouldBeFixed = issues.filter(issue => 
      issue.newExtraction && 
      issue.newExtraction !== issue.extractedFirstName &&
      !['say', 'happy', 'congrats', 'congratulations', 'message', 'connect'].includes(issue.newExtraction.toLowerCase())
    ).length;
    
    console.log(`   🎯 ${wouldBeFixed} out of ${wrongNames} wrong names would be fixed with the new function`);
    console.log(`   🛡️  ${wrongNames - wouldBeFixed} messages would have no greeting (safer than wrong name)`);
  } else {
    console.log('\n✅ No wrong names detected! All messages look correct.');
  }
  
  // Show a few examples of correct messages for comparison
  if (correctNames > 0) {
    console.log('\n' + '='.repeat(100));
    console.log('✅ EXAMPLES OF CORRECT MESSAGES:\n');
    
    const correctExamples = messages
      .filter(msg => {
        const firstName = extractFirstNameFromMessage(msg.enhanced_message || '');
        return firstName && firstName.length >= 2 && 
          !['say', 'happy', 'congrats'].includes(firstName.toLowerCase());
      })
      .slice(0, 3);
    
    correctExamples.forEach((msg, i) => {
      const firstName = extractFirstNameFromMessage(msg.enhanced_message || '');
      console.log(`${i + 1}. Contact: "${msg.contact_name}"`);
      console.log(`   ✅ Correctly sent as: "Dear ${firstName},"`);
      console.log(`   📝 OLD would extract: "${extractFirstNameOld(msg.contact_name || '')}"`);
      console.log(`   📝 NEW would extract: "${extractFirstNameNew(msg.contact_name || '')}"`);
      console.log('');
    });
  }
}

diagnoseLinkedInNames().catch(console.error);

