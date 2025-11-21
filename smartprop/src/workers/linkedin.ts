#!/usr/bin/env bun

/**
 * LinkedIn Catch-Up Message Automation Worker
 * Automates sending congratulations messages for birthdays, work anniversaries, and job changes
 */

import { chromium } from 'playwright-ghost';
import plugins from 'playwright-ghost/plugins';
import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';
import { humanPause } from './stealth.js';
import {
  getStorageStatePath,
  hasStorageState,
  deleteStorageState,
  writeLockFile,
  readLockFile,
  deleteLockFile,
  getLockFilePath,
  LinkedInLockData,
  isProcessRunning
} from '@/lib/linkedin/storage';
import {
  getLinkedInSettings,
  wasContactMessaged,
  createLinkedInMessage,
  updateLinkedInMessage,
  getTodayMessageCount,
  updateDailyStats
} from '@/lib/linkedin/tracker';
import { getSupabaseClient } from '@/workers/supa';
import { Page, Locator } from 'playwright-core';

async function fillInputValue(page: Page, selector: string, value: string): Promise<void> {
  const success = await page.evaluate(
    ({ selector, value }) => {
      const input = document.querySelector<HTMLInputElement>(selector);
      if (!input) {
        return false;
      }
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    { selector, value }
  );

  if (!success) {
    throw new Error(`Unable to fill input: ${selector}`);
  }
}

async function handleAccountPicker(page: Page): Promise<void> {
  try {
    const picker = page.locator('text="Sign in using another account"');
    if (await picker.count() > 0) {
      console.log('   ✏️ Account picker detected; clicking "Sign in using another account"');
      await picker.first().click();
      await humanPause(1000, 2000);
      return;
    }

    const useAnother = page.locator('text="Use another account"');
    if (await useAnother.count() > 0) {
      console.log('   ✏️ Account picker detected; clicking "Use another account"');
      await useAnother.first().click();
      await humanPause(1000, 2000);
      return;
    }
  } catch (error: any) {
    console.warn('   ⚠️ Unable to handle account picker:', (error as Error).message);
  }
}

async function waitForLandingPage(page: Page): Promise<boolean> {
  const fallbackPattern = /linkedin\.com\/(feed|in|mynetwork|checkpoint|login(-submit)?)/i;
  const timeouts = [60000, 30000];
  for (const timeout of timeouts) {
    try {
      await page.waitForURL(fallbackPattern, { timeout });
      return true;
    } catch {
      console.log(`   ⚠️  Landing page not detected within ${timeout}ms`);
    }
  }
  return false;
}

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env') });
config({ path: path.resolve(process.cwd(), '.env.local') });

interface Contact {
  name: string;
  profileUrl: string;
  linkedinId?: string;
  messageType: 'birthday' | 'work_anniversary' | 'job_change';
  messageButton?: Locator;
  hasMessageSent?: boolean;
}

interface ProcessResult {
  success: boolean;
  contactsFound: number;
  messagesSent: number;
  messagesFailed: number;
  messagesSkipped: number;
  errors: string[];
}

/**
 * Detect message type from contact card text
 */
function detectMessageType(text: string): 'birthday' | 'work_anniversary' | 'job_change' | null {
  const lowerText = text.toLowerCase();
  
  // Birthday patterns
  if (
    lowerText.includes('happy birthday') ||
    lowerText.includes('birthday') ||
    lowerText.includes('turning') ||
    lowerText.includes('celebrate') ||
    lowerText.includes('🎂') ||
    lowerText.includes('🎉')
  ) {
    return 'birthday';
  }
  
  // Work anniversary patterns
  if (
    lowerText.includes('work anniversary') ||
    lowerText.includes('anniversary') ||
    lowerText.includes('years at') ||
    lowerText.includes('milestone') ||
    lowerText.includes('workiversary') ||
    lowerText.includes('celebrating')
  ) {
    return 'work_anniversary';
  }
  
  // Job change patterns
  if (
    lowerText.includes('congratulations on your promotion') ||
    lowerText.includes('promoted') ||
    lowerText.includes('new role') ||
    lowerText.includes('new job') ||
    lowerText.includes('new position') ||
    lowerText.includes('career move') ||
    lowerText.includes('joined') ||
    lowerText.includes('moved to') ||
    lowerText.includes('started a new role') ||
    lowerText.includes('congrats')
  ) {
    return 'job_change';
  }
  
  return null;
}

/**
 * Scroll to load all contacts using infinite scroll
 * CRITICAL: Don't scroll up while loading
 */
/**
 * Scroll to load more contacts (infinite scroll helper)
 */
async function scrollToLoadMore(page: Page, containerLocator: Locator): Promise<void> {
  try {
    const containerEl = await containerLocator.first().elementHandle();
    if (containerEl) {
      // Scroll container
      await page.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      }, containerEl);
      await humanPause(1000, 1500);
      
      // Also scroll window
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await humanPause(1000, 1500);
      
      // Check for "Load more" button
      const loadMoreButton = page.locator('button:has-text("Load more"), button:has-text("Show more")').first();
      const hasLoadMore = await loadMoreButton.count() > 0 && await loadMoreButton.isVisible().catch(() => false);
      if (hasLoadMore) {
        console.log('   🔄 Clicking "Load more" button...');
        await loadMoreButton.click();
        await humanPause(2000, 3000);
      }
    } else {
      // Fallback: just scroll window
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await humanPause(2000, 3000);
    }
  } catch (e: any) {
    console.log(`   ⚠️  Error scrolling: ${e.message}`);
  }
}

async function scrollToLoadAllContacts(page: Page, containerLocator: Locator): Promise<number> {
  let previousCount = 0;
  let currentCount = 0;
  let noNewLoadsCount = 0;
  const maxNoNewLoads = 3; // Stop after 3 consecutive scrolls with no new items
  
  console.log('📜 Starting infinite scroll to load all contacts...');
  
  do {
    previousCount = currentCount;
    
    // Get container element
    const container = await containerLocator.first().elementHandle();
    if (!container) {
      console.error('Container element not found');
      break;
    }
    
    // Scroll to bottom of container
    await page.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    }, container);
    
    // Wait a bit for scroll to trigger
    await humanPause(500, 1000);
    
    // Wait for potential loading indicator to disappear
    const loadingIndicator = page.locator('[data-testid*="loading"], .loading, [aria-label*="Loading"], [aria-busy="true"]');
    const loadingCount = await loadingIndicator.count();
    
    if (loadingCount > 0) {
      console.log('   ⏳ Waiting for content to load...');
      try {
        await loadingIndicator.first().waitFor({ state: 'hidden', timeout: 10000 });
      } catch (e) {
        // Timeout is OK, just continue
      }
    }
    
    // Wait a bit more for content to settle
    await humanPause(500, 800);
    
    // Check for "Load more" button and click it if present
    const loadMoreButton = page.locator('button:has-text("Load more"), button:has-text("Show more")').first();
    const hasLoadMore = await loadMoreButton.count() > 0;
    
    if (hasLoadMore) {
      try {
        const isVisible = await loadMoreButton.isVisible();
        if (isVisible) {
          console.log('   🔄 Clicking "Load more" button...');
          await loadMoreButton.click();
          await humanPause(2000, 3000);
        }
      } catch (e) {
        // Button might have disappeared, continue
      }
    }
    
    // Count contact items - use same selectors as extractContacts
    const contactItems = page.locator('main list[role="list"] > listitem, main ul > li, main ol > li, li:has(a[href*="/messaging/compose/"])');
    currentCount = await contactItems.count();
    
    console.log(`   📊 Contacts loaded: ${currentCount} (previous: ${previousCount})`);
    
    if (currentCount === previousCount) {
      noNewLoadsCount++;
      console.log(`   ⚠️  No new contacts (${noNewLoadsCount}/${maxNoNewLoads})`);
    } else {
      noNewLoadsCount = 0;
    }
    
    // Small pause between scrolls
    await humanPause(300, 600);
    
  } while (noNewLoadsCount < maxNoNewLoads && currentCount < 1000); // Safety limit
  
  console.log(`✅ Finished loading contacts. Total: ${currentCount}`);
  return currentCount;
}

/**
 * Extract contacts from the catch-up tab
 */
async function extractContacts(page: Page): Promise<Contact[]> {
  const contacts: Contact[] = [];

  console.log('🔍 Extracting contacts from catch-up tab...');
  const messageComposeLinks = page.locator('a[href*="/messaging/compose/"]');
  const messageLinkCount = await messageComposeLinks.count();

  console.log(`   ✓ Found ${messageLinkCount} message compose links`);

  if (messageLinkCount === 0) {
    console.warn('   ⚠️  No message compose links found');
    return contacts;
  }

  for (let i = 0; i < messageLinkCount; i++) {
    try {
      const messageLink = messageComposeLinks.nth(i);
      await messageLink.scrollIntoViewIfNeeded();
      await humanPause(200, 400);

      const contactInfo = await page.evaluate((linkIndex) => {
        const allLinks = Array.from(document.querySelectorAll('a[href*="/messaging/compose/"]'));
        const link = allLinks[linkIndex];
        if (!link) return null;

        const ariaLabel = link.getAttribute('aria-label') || '';
        const parsedName =
          ariaLabel.includes(':') && ariaLabel.toLowerCase().startsWith('message')
            ? ariaLabel.split(':')[0].replace(/message/i, '').trim()
            : undefined;

        let container: Element | null = link;
        let depth = 0;
        let profileUrl = '';
        let derivedName = parsedName;
        let hasMessageSent = false;

        const cleanupText = (text: string) => text.replace(/\s+/g, ' ').trim();

        while (container && depth < 12) {
          const paragraphs = Array.from(container.querySelectorAll('p'));
          for (const paragraph of paragraphs) {
            if (link.contains(paragraph)) continue; // message copy is inside the link
            const paragraphText = cleanupText(paragraph.textContent || '');
            if (paragraphText.toLowerCase() === 'message sent') {
              hasMessageSent = true;
              break;
            }
            if (!derivedName && paragraphText) {
              derivedName = paragraphText.split(',')[0].trim();
            }
          }

          if (!profileUrl) {
            const profileLink = container.querySelector('a[href*="/in/"]');
            if (profileLink) {
              profileUrl = profileLink.getAttribute('href') || '';
            }
          }

          if ((profileUrl && derivedName) || hasMessageSent) break;
          container = container.parentElement;
          depth++;
        }

        const messageSnippet = cleanupText(link.textContent || ariaLabel);
        return {
          name: derivedName || 'Unknown',
          profileUrl,
          hasMessageSent,
          messageSnippet
        };
      }, i);

      if (!contactInfo) {
        console.warn(`   ⚠️  Message link ${i + 1}: Could not find contact info, skipping`);
        continue;
      }

      if (!contactInfo.profileUrl) {
        console.warn(`   ⚠️  Message link ${i + 1}: No profile URL found, skipping`);
        continue;
      }

      let profileUrl = contactInfo.profileUrl;
      if (profileUrl.startsWith('/')) {
        profileUrl = `https://www.linkedin.com${profileUrl}`;
      }
      profileUrl = profileUrl.split('?')[0];

      const linkedinIdMatch = profileUrl.match(/\/in\/([^\/\?]+)/);
      const linkedinId = linkedinIdMatch ? linkedinIdMatch[1] : undefined;

      if (contactInfo.hasMessageSent) {
        console.log(`   ⏭️  Skipping ${contactInfo.name}: Page shows "Message sent"`);
        continue;
      }

      const detectedType = detectMessageType(contactInfo.messageSnippet || '') || 'work_anniversary';
      contacts.push({
        name: contactInfo.name,
        profileUrl,
        linkedinId,
        messageType: detectedType,
        messageButton: messageLink,
        hasMessageSent: false
      });

      console.log(`   ✅ Found: ${contactInfo.name} (${detectedType}) - Message link ${i + 1}`);
    } catch (error: any) {
      console.error(`   ❌ Error processing message link ${i + 1}:`, error.message);
      continue;
    }
  }

  console.log(`✅ Extracted ${contacts.length} contacts ready for messaging`);
  return contacts;
}

/**
 * Enhance LinkedIn's pre-filled message with profile and company links
 */
function enhanceMessage(
  originalTemplate: string,
  profileUrl: string,
  companyUrl: string,
  profileTemplate: string,
  companyTemplate: string
): string {
  let enhanced = originalTemplate.trim();
  
  // Replace placeholders in templates
  const profileText = profileTemplate.replace('{profile_url}', profileUrl);
  const companyText = companyTemplate.replace('{company_url}', companyUrl);
  
  // Append templates
  enhanced += profileText;
  enhanced += '\n' + companyText;
  
  return enhanced;
}

/**
 * Process a single contact and send message
 */
async function processContact(
  page: Page,
  contact: Contact,
  settings: any,
  lockData: LinkedInLockData
): Promise<{ success: boolean; error?: string }> {
  let messageId: string | null = null; // Track messageId for error handling
  
  try {
    console.log(`\n💬 Processing: ${contact.name} (${contact.messageType})`);
    
    // If page shows "Message sent", skip - this means LinkedIn shows it was already messaged
    if (contact.hasMessageSent) {
      console.log(`   ⏭️  Page shows "${contact.name}" was already messaged (Message sent visible), skipping`);
      
      // Update database to match page state
      const supabase = getSupabaseClient();
      const { data: existing } = await supabase
        .from('linkedin_messages')
        .select('id, status')
        .eq('contact_profile_url', contact.profileUrl)
        .limit(1);

      if (existing && existing.length > 0 && existing[0].status !== 'sent') {
        // Update existing record to 'sent' since page shows it was sent
        console.log(`   📝 Updating existing record for ${contact.name} to 'sent'...`);
        await updateLinkedInMessage(existing[0].id, {
          status: 'sent',
          sent_at: new Date().toISOString()
        });
      } else if (!existing || existing.length === 0) {
        // Create record if it doesn't exist
        await createLinkedInMessage({
          contact_name: contact.name,
          contact_profile_url: contact.profileUrl,
          contact_linkedin_id: contact.linkedinId || null,
          message_type: contact.messageType,
          original_template: null,
          enhanced_message: null,
          status: 'sent',
          sent_at: new Date().toISOString(),
          error_message: null,
          linkedin_job_id: null
        }).catch(() => {}); // Ignore duplicate key errors
      }

      return { success: true }; // Counted as success (already messaged)
    }

    // No need to check database - if we have a message button, they haven't been messaged
    console.log(`   ✅ ${contact.name} has message button - proceeding to send message...`);
    
    // Click message link/button to open dialog
    console.log(`   🖱️  Clicking message button for ${contact.name}...`);
    if (contact.messageButton) {
      try {
        await contact.messageButton.scrollIntoViewIfNeeded({ timeout: 5000 });
        await humanPause(300, 500);
        
        // Try to click with multiple strategies
        try {
          await contact.messageButton.click({ timeout: 10000 });
        } catch (e: any) {
          console.log(`   ⚠️  First click attempt failed, trying with force...`);
          await contact.messageButton.click({ force: true, timeout: 10000 });
        }
        
        await humanPause(2000, 3000); // Wait for dialog to open
      } catch (e: any) {
        console.log(`   ⚠️  Error clicking message button: ${e.message}, trying to find link directly...`);
        // Fall through to find link directly
      }
    }
    
    // If clicking button didn't work or button wasn't available, find the link directly
    if (!contact.messageButton || true) {
      // Try to find message link/button again
      const messageLink = page.locator(`a[href*="/messaging/compose/"]`).first();
      const messageBtn = page.locator(`button:has-text("Message"), button[aria-label*="Message"]`).first();
      
      if (await messageLink.count() > 0) {
        await messageLink.click();
        await humanPause(2000, 3000);
      } else if (await messageBtn.count() > 0) {
        await messageBtn.click();
        await humanPause(2000, 3000);
      } else {
        throw new Error('Message button/link not found');
      }
    }
    
    // Wait for message dialog to load and be visible
    console.log('   ⏳ Waiting for message dialog...');
    const messageDialog = page.locator('dialog[role="dialog"], [role="dialog"]').first();
    await messageDialog.waitFor({ state: 'visible', timeout: 15000 });
    await humanPause(1000, 2000);
    
    // Wait for message input field - try multiple selectors
    const messageInputSelectors = [
      'textbox[role="textbox"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="message" i]',
      'textarea[aria-label*="message" i]',
      'textarea'
    ];
    
    let messageInput: Locator | null = null;
    for (const selector of messageInputSelectors) {
      const input = messageDialog.locator(selector).first();
      const count = await input.count();
      if (count > 0) {
        await input.waitFor({ state: 'visible', timeout: 5000 });
        messageInput = input;
        console.log(`   ✅ Found message input with selector: ${selector}`);
        break;
      }
    }
    
    if (!messageInput) {
      throw new Error('Message input field not found in dialog');
    }
    
    await humanPause(500, 1000);
    
    // Extract LinkedIn's pre-filled template
    const originalTemplate = await messageInput.textContent().catch(() => '') || 
                           await messageInput.inputValue().catch(() => '') || '';
    
    if (!originalTemplate.trim()) {
      console.warn(`   ⚠️  No pre-filled template found`);
      // Continue anyway with just our links
    }
    
    // Enhance message
    const enhancedMessage = enhanceMessage(
      originalTemplate,
      settings.profile_url || '',
      settings.company_url,
      settings.message_template_profile,
      settings.message_template_company
    );
    
    // Check if record exists first (upsert logic to prevent duplicate key errors)
    const supabase = getSupabaseClient();
    const { data: existing } = await supabase
      .from('linkedin_messages')
      .select('id, status')
      .eq('contact_profile_url', contact.profileUrl)
      .limit(1);
    
    if (existing && existing.length > 0) {
      // Use existing record
      messageId = existing[0].id;
      console.log(`   📝 Using existing record (ID: ${messageId}, status: ${existing[0].status}) for ${contact.name}`);
      
      // Update to pending if it was failed before
      if (existing[0].status === 'failed') {
        await updateLinkedInMessage(messageId, {
          status: 'pending',
          error_message: null,
          enhanced_message: enhancedMessage
        });
      }
    } else {
      // Create new pending record
      messageId = await createLinkedInMessage({
        contact_name: contact.name,
        contact_profile_url: contact.profileUrl,
        contact_linkedin_id: contact.linkedinId || null,
        message_type: contact.messageType,
        original_template: originalTemplate || null,
        enhanced_message: enhancedMessage,
        status: 'pending',
        sent_at: null,
        error_message: null,
        linkedin_job_id: null
      });
      
      if (!messageId) {
        // Race condition - check again if create failed
        const { data: retryExisting } = await supabase
          .from('linkedin_messages')
          .select('id')
          .eq('contact_profile_url', contact.profileUrl)
          .limit(1);
        
        if (retryExisting && retryExisting.length > 0) {
          messageId = retryExisting[0].id;
          console.log(`   ⚠️  Create failed but found existing record (ID: ${messageId}) - race condition handled`);
        } else {
          throw new Error('Failed to create message record');
        }
      }
    }
    
    // Clear existing content and type enhanced message
    await messageInput.click();
    await humanPause(200, 400);
    
    // Clear existing content - select all and delete
    // Use Meta+A (Cmd+A) on Mac, Control+A on Windows/Linux
    const isMac = process.platform === 'darwin';
    await messageInput.click({ clickCount: 3 }); // Triple click to select all text
    await humanPause(200, 400);
    await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await humanPause(100, 200);
    await page.keyboard.press('Backspace'); // Clear selected content
    await humanPause(300, 500);
    
    // Type enhanced message with human-like delays
    // For textbox role elements, use fill; for contenteditable, use type or innerText
    const tagName = await messageInput.evaluate((el: any) => el.tagName?.toLowerCase()).catch(() => '');
    const role = await messageInput.getAttribute('role').catch(() => '');
    
    if (tagName === 'textarea' || role === 'textbox') {
      // Use fill for standard inputs
      await messageInput.fill(enhancedMessage);
    } else {
      // For contenteditable divs, set innerText and trigger input event
      await messageInput.evaluate((el: any, text: string) => {
        el.focus();
        el.innerText = text;
        // Trigger input and change events
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, enhancedMessage);
    }
    
    await humanPause(1000, 2000); // Wait for text to be set
    
    // Find and click send button - look in dialog first
    console.log('   🔍 Looking for Send button...');
    const sendButtonSelectors = [
      'button:has-text("Send")',
      'button[aria-label*="Send" i]',
      'button[type="submit"]'
    ];
    
    let sendButton: Locator | null = null;
    for (const selector of sendButtonSelectors) {
      // Try in dialog first
      const btn = messageDialog.locator(selector).first();
      const count = await btn.count();
      if (count > 0) {
        await btn.waitFor({ state: 'visible', timeout: 3000 });
        sendButton = btn;
        console.log(`   ✅ Found Send button with selector: ${selector}`);
        break;
      }
    }
    
    if (!sendButton) {
      // Try page-level search as fallback
      sendButton = page.locator('button:has-text("Send")').first();
      const count = await sendButton.count();
      if (count === 0) {
        throw new Error('Send button not found');
      }
    }
    
    await sendButton.scrollIntoViewIfNeeded();
    await humanPause(300, 600);
    console.log('   📤 Clicking Send button...');
    
    // Check if button is disabled (might be if message is empty)
    const isDisabled = await sendButton.isDisabled().catch(() => false);
    if (isDisabled) {
      console.warn('   ⚠️  Send button is disabled, message might be empty');
      // Try typing the message again
      await messageInput.fill(enhancedMessage);
      await humanPause(500, 1000);
    }
    
    console.log(`   🖱️  Clicking Send button for ${contact.name}...`);
    await sendButton.click();
    
    // Wait for confirmation - look for "Message sent" indicator or dialog closing
    console.log(`   ⏳ Waiting for message confirmation for ${contact.name}...`);
    let messageConfirmed = false;
    try {
      // Wait for "Message sent" text or similar indicator
      await page.waitForSelector('text="Message sent", text=/Message sent/i', { timeout: 8000 }).catch(() => {});
      messageConfirmed = true;
      console.log(`   ✅ Message sent confirmation received for ${contact.name}`);
    } catch (e) {
      console.log(`   ⚠️  Message confirmation not visible, but continuing...`);
      // Confirmation might not appear, that's okay - check if dialog closed
      await humanPause(1000, 1500);
    }
    
    // Wait a bit more for the message to actually send
    await humanPause(1500, 2500);
    
    // Verify the message was sent by checking if dialog is closed or "Message sent" appears on page
    const dialogStillOpen = await messageDialog.isVisible().catch(() => false);
    if (dialogStillOpen) {
      console.log(`   ⚠️  Dialog still open for ${contact.name}, trying to close...`);
      const closeButton = messageDialog.locator('button[aria-label*="Close"], button:has-text("Close")').first();
      if (await closeButton.count() > 0) {
        await closeButton.click();
        await humanPause(500, 1000);
      }
    } else {
      console.log(`   ✅ Dialog closed for ${contact.name}, message likely sent`);
    }
    
    // Close dialog if still open (click outside or close button)
    try {
      const closeButton = messageDialog.locator('button[aria-label*="Close"], button:has-text("Close")').first();
      const closeCount = await closeButton.count();
      if (closeCount > 0 && await closeButton.isVisible().catch(() => false)) {
        await closeButton.click();
        await humanPause(500, 1000);
      }
    } catch (e) {
      // Dialog might already be closed
    }
    
    // Only mark as sent if we got confirmation OR dialog closed
    if (messageConfirmed || !dialogStillOpen) {
      console.log(`   ✅ Confirming message was sent for ${contact.name}...`);
      await updateLinkedInMessage(messageId, {
        status: 'sent',
        sent_at: new Date().toISOString()
      });
      console.log(`   ✅ Message marked as sent in database for ${contact.name}`);
    } else {
      console.log(`   ⚠️  Message confirmation unclear for ${contact.name}, marking as failed`);
      await updateLinkedInMessage(messageId, {
        status: 'failed',
        error_message: 'Message confirmation not received'
      });
      throw new Error('Message confirmation not received');
    }
    return { success: true };
    
  } catch (error: any) {
    const errorMsg = error.message || 'Unknown error';
    console.error(`   ❌ Error processing contact: ${errorMsg}`);
    
    // Update message record as failed (use upsert logic to avoid duplicate key errors)
    try {
      if (messageId) {
        // Update existing record
        await updateLinkedInMessage(messageId, {
          status: 'failed',
          error_message: errorMsg
        });
      } else {
        // Try to find existing record
        const supabase = getSupabaseClient();
        const { data: existing } = await supabase
          .from('linkedin_messages')
          .select('id')
          .eq('contact_profile_url', contact.profileUrl)
          .limit(1);

        if (existing && existing.length > 0) {
          // Update existing record
          await updateLinkedInMessage(existing[0].id, {
            status: 'failed',
            error_message: errorMsg
          });
        } else {
          // Create new failed record (ignore duplicate key errors)
          await createLinkedInMessage({
            contact_name: contact.name,
            contact_profile_url: contact.profileUrl,
            contact_linkedin_id: contact.linkedinId || null,
            message_type: contact.messageType,
            original_template: null,
            enhanced_message: null,
            status: 'failed',
            sent_at: null,
            error_message: errorMsg,
            linkedin_job_id: null
          }).catch(() => {}); // Ignore duplicate key errors
        }
      }
    } catch (e) {
      // Ignore errors when updating failed record
      console.error(`   ⚠️  Error updating failed record: ${e}`);
    }
    
    return { success: false, error: errorMsg };
  }
}

/**
 * Main LinkedIn automation function
 */
async function automateLinkedInMessages(dryRun: boolean = false): Promise<ProcessResult> {
  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;
  
  if (!email || !password) {
    throw new Error('LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set in .env');
  }
  
  // Get settings
  const settings = await getLinkedInSettings();
  if (!settings) {
    throw new Error('LinkedIn settings not found. Please configure settings first.');
  }
  
  if (!settings.enabled) {
    throw new Error('LinkedIn automation is disabled. Enable it in settings first.');
  }
  
  // Check for existing lock file
  const existingLock = readLockFile();
  if (existingLock && existingLock.status === 'running') {
    const isRunning = await isProcessRunning(existingLock.pid);
    if (isRunning) {
      throw new Error('LinkedIn automation is already running');
    } else {
      // Stale lock, clean it up
      deleteLockFile();
    }
  }
  
  // Create lock file
  const lockData: LinkedInLockData = {
    pid: process.pid,
    status: 'running',
    startedAt: new Date().toISOString(),
    contactsProcessed: 0,
    messagesSent: 0,
    messagesFailed: 0,
    currentContactIndex: 0
  };
  writeLockFile(lockData);
  
  // Detect headless mode - default to HEADED (visible) for debugging and user visibility
  const forceHeadless = process.env.HEADLESS === 'true' || process.env.HEADLESS === '1';
  const forceHeaded = process.env.HEADLESS === 'false' || process.env.HEADLESS === '0';
  
  // Default to HEADED mode unless explicitly set to headless or in production
  const headlessMode = forceHeaded ? false : (forceHeadless ? true : (process.env.NODE_ENV === 'production' && process.env.CI !== 'true'));
  
  console.log(`🚀 Launching LinkedIn automation (${headlessMode ? 'headless' : 'headed'} mode)...`);
  if (!headlessMode) {
    console.log('   👁️  Browser will remain visible so you can watch the process');
  }
  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - No messages will be sent');
  }
  
  // Launch browser with stealth
  const browser = await chromium.launch({
    headless: headlessMode,
    plugins: plugins.recommended({
      humanize: {
        click: { delay: { min: 200, max: 600 } },
        cursor: false,
        dialog: { delay: { min: 800, max: 2000 } }
      }
    }),
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu'
    ]
  });
  
  const storagePath = getStorageStatePath();
  const hadSavedSession = hasStorageState();
  if (hadSavedSession) {
    console.log('   🧹 Clearing saved session to avoid account-picker screen');
    deleteStorageState();
  }

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: settings.timezone || 'Asia/Singapore',
    // Load saved storage state if exists
    ...(hasStorageState() ? { storageState: storagePath } : {})
  });
  
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });
  
  const page = await context.newPage();
  const result: ProcessResult = {
    success: false,
    contactsFound: 0,
    messagesSent: 0,
    messagesFailed: 0,
    messagesSkipped: 0,
    errors: []
  };
  
  try {
    // Login if needed
    if (!hasStorageState()) {
      console.log('🔐 Logging in to LinkedIn...');
      await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
      console.log('   🌐 Login URL:', page.url());
      console.log('   🏷️  Title:', await page.title());
      await humanPause(2000, 3000);
      
      await handleAccountPicker(page);

      // Fill email
      const emailSelector = 'input[aria-label="Email or phone"], input[name="session_key"]';
      console.log('   🎯 Filling email via selector:', emailSelector);
      await fillInputValue(page, emailSelector, email);
      await humanPause(500, 1000);
      
      // Fill password
      const passwordSelector = 'input[aria-label="Password"], input[name="session_password"]';
      console.log('   🛡️ Filling password via selector:', passwordSelector);
      await fillInputValue(page, passwordSelector, password);
      await humanPause(500, 1000);
      
      // Click login - use specific selector to avoid clicking "Sign in with Apple" or social login buttons
      // Target the form submit button specifically, not social login buttons
      const loginButtonSelectors = [
        'button[type="submit"]',  // Form submit button (most specific)
        'form button[type="submit"]',  // Submit button within form
      ];
      
      let loginButton: Locator | null = null;
      for (const selector of loginButtonSelectors) {
        const btn = page.locator(selector).first();
        const count = await btn.count();
        if (count > 0) {
          const text = await btn.textContent().catch(() => '');
          // Make sure it's not a social login button (should just say "Sign in")
          if (text && text.trim().toLowerCase() === 'sign in') {
            loginButton = btn;
            console.log(`   ✅ Found login button with selector: ${selector}`);
            break;
          }
        }
      }
      
      if (!loginButton) {
        // Fallback: use getByRole for exact "Sign in" button
        loginButton = page.getByRole('button', { name: 'Sign in', exact: true }).first();
        const count = await loginButton.count();
        if (count === 0) {
          throw new Error('Login button not found');
        }
        console.log('   ✅ Found login button using getByRole');
      }
      
      await loginButton.click();
      
      // Wait for login
      const landed = await waitForLandingPage(page);
      if (!landed) {
        console.log('   ⚠️  Unable to confirm landing page URL after login, proceeding with catch-up navigation');
      }
      await humanPause(3000, 5000);
      
      // Save storage state
      await context.storageState({ path: getStorageStatePath() });
      console.log('✅ Logged in and saved session');
    } else {
      // Verify session is still valid - use faster load strategy
      console.log('🔍 Verifying session...');
      try {
        await page.goto('https://www.linkedin.com/feed', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await humanPause(2000, 3000);
      } catch (timeoutError: any) {
        // If feed times out, try catch-up page directly - session might still be valid
        console.log('   ⚠️  Feed page load slow, trying catch-up page directly...');
        try {
          await page.goto('https://www.linkedin.com/mynetwork/catch-up/all/', { waitUntil: 'domcontentloaded', timeout: 60000 });
          await humanPause(2000, 3000);
          console.log('   ✅ Session appears valid (catch-up page loaded)');
        } catch (e: any) {
          // Session likely expired, delete and login fresh
          console.log('   ⚠️  Session expired, will login fresh');
          deleteStorageState();
          throw new Error('Session expired');
        }
      }
      
      // Check if logged in (multiple checks for robustness)
      const navCheck = await page.locator('nav[role="navigation"], nav.global-nav, header[role="banner"]').count() > 0;
      const feedCheck = await page.locator('main, .feed-container, [data-testid="feed-container"]').count() > 0;
      const loginCheck = await page.locator('input[name="session_key"], .login-form').count() === 0;
      
      const isLoggedIn = (navCheck || feedCheck) && loginCheck;
      
      if (!isLoggedIn) {
        console.log('⚠️  Session expired, attempting fresh login...');
        // Delete invalid session and login fresh
        deleteStorageState();
        await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
        console.log('   🌐 Login URL (refresh):', page.url());
        console.log('   🏷️  Title (refresh):', await page.title());
        await humanPause(2000, 3000);
        
        await handleAccountPicker(page);

        // Fill email
        const emailSelector = 'input[aria-label="Email or phone"], input[name="session_key"]';
        console.log('   🎯 Filling email via selector (session refresh):', emailSelector);
        await fillInputValue(page, emailSelector, email);
        await humanPause(500, 1000);
        
        // Fill password
        const passwordSelector = 'input[aria-label="Password"], input[name="session_password"]';
        console.log('   🛡️ Filling password via selector (session refresh):', passwordSelector);
        await fillInputValue(page, passwordSelector, password);
        await humanPause(500, 1000);
        
        // Click login - use more specific selector to avoid clicking "Sign in with Apple"
        // Target the form submit button specifically, not social login buttons
        const loginButtonSelectors = [
          'button[type="submit"]',  // Form submit button
          'form button[type="submit"]',  // Submit button within form
          'button[type="submit"]:not(:has-text("Apple")):not(:has-text("Google"))',  // Submit but not social login
        ];
        
        let loginButton: Locator | null = null;
        for (const selector of loginButtonSelectors) {
          const btn = page.locator(selector).first();
          const count = await btn.count();
          if (count > 0) {
            const text = await btn.textContent().catch(() => '');
            // Make sure it's not a social login button
            if (text && !text.toLowerCase().includes('apple') && !text.toLowerCase().includes('google')) {
              loginButton = btn;
              console.log(`   ✅ Found login button with selector: ${selector}`);
              break;
            }
          }
        }
        
        if (!loginButton) {
          // Fallback: use getByRole for submit button
          loginButton = page.getByRole('button', { name: 'Sign in', exact: true }).first();
          const count = await loginButton.count();
          if (count === 0) {
            throw new Error('Login button not found');
          }
        }
        
        await loginButton.click();
        
        // Wait for login
        const landed = await waitForLandingPage(page);
        if (!landed) {
          console.log('   ⚠️  Unable to confirm landing page URL after login, proceeding with catch-up navigation');
        }
        await humanPause(3000, 5000);
        
        // Save storage state
        await context.storageState({ path: getStorageStatePath() });
        console.log('✅ Logged in and saved session');
      } else {
        console.log('✅ Session verified');
      }
    }
    
    // Navigate directly to catch-up page (faster than clicking tab)
    console.log('📍 Navigating directly to Catch Up page...');
    try {
      await page.goto('https://www.linkedin.com/mynetwork/catch-up/all/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await humanPause(2000, 3000);
      
      // Wait for contacts list to load
      const contactsList = page.locator('main list[role="list"], main ul, main ol').first();
      await contactsList.waitFor({ state: 'visible', timeout: 15000 });
      console.log('   ✅ Catch Up page loaded');
    } catch (error: any) {
      console.error('❌ Error navigating to Catch Up page:', error.message);
      throw error;
    }
    
    // Find contacts container (main element)
    const container = page.locator('main').first();
    
    // NEW FLOW: Process contacts incrementally as we load them
    // Send messages to visible contacts first, then scroll to load more
    console.log('📋 Starting incremental contact processing...');
    
    let totalProcessed = 0;
    let totalSent = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 200; // Increased limit to allow extensive scrolling
    const processedProfileUrls = new Set<string>(); // Track processed contacts to avoid duplicates
    
    // Use messages_per_job (default 50) instead of daily_limit
    const messagesPerJob = settings.messages_per_job || 50;
    // Continue scrolling until we reach messages_per_job limit or max scroll attempts
    while (totalSent < messagesPerJob && scrollAttempts < maxScrollAttempts) {
      // Extract currently visible contacts
      console.log(`\n🔍 Extracting visible contacts (attempt ${scrollAttempts + 1})...`);
      const visibleContacts = await extractContacts(page);
      
      if (visibleContacts.length === 0) {
        console.log('   ℹ️  No contacts found on page. Scrolling to load more...');
        scrollAttempts++;
        // Scroll to load more even if no contacts found
        await scrollToLoadMore(page, container);
        await humanPause(2000, 3000);
        continue;
      }
      
      // Filter out already processed contacts
      const newContacts = visibleContacts.filter(contact => !processedProfileUrls.has(contact.profileUrl));
      
      if (newContacts.length === 0) {
        console.log(`   ℹ️  All visible contacts already processed (all have "Message sent" or were already processed). Scrolling to load more...`);
        scrollAttempts++;
        // Scroll to load more - all visible contacts are already messaged
        await scrollToLoadMore(page, container);
        await humanPause(2000, 3000);
        continue;
      }
      
      console.log(`   ✅ Found ${newContacts.length} new contacts to process`);
      console.log(`   📋 Contact names: ${newContacts.map(c => c.name).join(', ')}`);
      result.contactsFound += newContacts.length;
      
      // Process each new contact
      for (let contactIndex = 0; contactIndex < newContacts.length; contactIndex++) {
        const contact = newContacts[contactIndex];
        console.log(`\n   [${contactIndex + 1}/${newContacts.length}] Starting to process: ${contact.name}`);
        // Check for stop signal
        const currentLock = readLockFile();
        if (currentLock?.status === 'stopping') {
          console.log('\n⏹️  Stop signal received, stopping gracefully...');
          break;
        }
        
        // Check messages per job limit
        if (totalSent >= messagesPerJob) {
          console.log(`\n⏸️  Messages per job limit reached (${totalSent}/${messagesPerJob}), stopping`);
          break;
        }
        
        // Mark as processed
        processedProfileUrls.add(contact.profileUrl);
        totalProcessed++;
        
        lockData.currentContactIndex = totalProcessed;
        lockData.lastContactName = contact.name;
        writeLockFile(lockData);
        
        if (dryRun) {
          console.log(`   [DRY RUN] Would process: ${contact.name} (${contact.messageType})`);
          totalSent++;
          result.messagesSent++;
        } else {
          console.log(`   💬 Calling processContact for ${contact.name}...`);
          const processResult = await processContact(page, contact, settings, lockData);
          console.log(`   📊 Result for ${contact.name}: ${processResult.success ? '✅ Success' : '❌ Failed'}${processResult.error ? ` - ${processResult.error}` : ''}`);
          
          lockData.contactsProcessed++;
          if (processResult.success) {
            totalSent++;
            result.messagesSent++;
            lockData.messagesSent++;
            console.log(`   ✅ Message sent to ${contact.name} (${totalSent}/${messagesPerJob} this job)`);
          } else {
            result.messagesFailed++;
            lockData.messagesFailed++;
            if (processResult.error) {
              result.errors.push(`${contact.name}: ${processResult.error}`);
            }
            console.log(`   ❌ Failed to send to ${contact.name}: ${processResult.error || 'Unknown error'}`);
            
          }
          writeLockFile(lockData);
          
          // Check again after processing
          if (totalSent >= messagesPerJob) {
            console.log(`\n⏸️  Messages per job limit reached (${totalSent}/${messagesPerJob}), stopping`);
            break;
          }
        }
        
        // Delay between contacts
        const delay = settings.min_delay + Math.random() * (settings.max_delay - settings.min_delay);
        await humanPause(Math.floor(delay), Math.floor(delay));
      }
      
      // If we've processed all visible contacts and haven't reached the limit, scroll to load more
      if (totalSent < messagesPerJob) {
        console.log(`\n📜 Scrolling to load more contacts (${totalSent}/${messagesPerJob} sent so far)...`);
        scrollAttempts++;
        await scrollToLoadMore(page, container);
        await humanPause(2000, 3000);
      } else {
        // Reached messages per job limit, break out of while loop
        console.log(`\n✅ Messages per job limit reached (${totalSent}/${messagesPerJob}), stopping automation`);
        break;
      }
    }
    
    // Final status check
    if (totalSent >= messagesPerJob) {
      console.log(`\n✅ Automation completed: Messages per job limit reached (${totalSent}/${messagesPerJob})`);
    } else if (scrollAttempts >= maxScrollAttempts) {
      console.log(`\n✅ Automation completed: Maximum scroll attempts reached (${scrollAttempts}). More contacts may be available with additional scrolling.`);
    } else {
      console.log(`\n✅ Automation completed: Stopped processing`);
    }
    
    console.log(`\n📊 Final Summary:`);
    console.log(`   - Contacts found: ${result.contactsFound}`);
    console.log(`   - Messages sent: ${result.messagesSent}`);
    console.log(`   - Messages failed: ${result.messagesFailed}`);
    console.log(`   - Total processed: ${totalProcessed}`);
    
    result.success = true;
    
    // Update daily stats (we'll count types from processed contacts)
    const byType = {
      birthday: 0,
      work_anniversary: 0,
      job_change: 0
    };
    // Note: We could track types as we process, but for now use placeholder
    await updateDailyStats(result.messagesSent, result.messagesFailed, result.contactsFound, byType);
    
  } catch (error: any) {
    console.error('❌ Error in LinkedIn automation:', error);
    console.error('   Stack:', error.stack);
    result.errors.push(error.message || 'Unknown error');
    result.success = false;
    
    // Update lock file with error
    lockData.status = 'stopped';
    lockData.error = error.message || 'Unknown error';
    writeLockFile(lockData);
    
    // If not headless, wait a bit so user can see the error
    if (!headlessMode) {
      console.log('\n⏸️  Pausing for 10 seconds so you can see the error in the browser...');
      await humanPause(10000, 10000);
    }
  } finally {
    try {
      // Save final storage state if context exists
      if (context) {
        await context.storageState({ path: getStorageStatePath() });
      }
    } catch (e) {
      console.warn('   ⚠️  Could not save storage state:', e);
    }
    
    // Update lock file
    lockData.status = 'stopped';
    writeLockFile(lockData);
    
    // Close browser
    try {
      await browser.close();
    } catch (e) {
      console.warn('   ⚠️  Error closing browser:', e);
    }
    
    console.log('\n✅ Automation completed');
    console.log(`   📊 Results: ${result.messagesSent} sent, ${result.messagesFailed} failed, ${result.messagesSkipped} skipped`);
  }
  
  return result;
}

// Run if executed directly
if (import.meta.main) {
  const dryRun = process.argv.includes('--dry-run');
  automateLinkedInMessages(dryRun)
    .then(result => {
      console.log('\n📊 Final Results:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    });
}

export { automateLinkedInMessages };

