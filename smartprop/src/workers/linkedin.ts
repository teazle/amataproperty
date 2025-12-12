#!/usr/bin/env bun

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * LinkedIn Catch-Up Message Automation Worker
 * Automates sending congratulations messages for birthdays, work anniversaries, and job changes
 */

import { chromium } from 'playwright-ghost';
import plugins from 'playwright-ghost/plugins';
import path from 'path';
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
  createLinkedInMessage,
  updateLinkedInMessage,
  getTodayMessageCount,
  updateDailyStats
} from '@/lib/linkedin/tracker';
import { getSupabaseClient } from '@/workers/supa';
import { Page, Locator, BrowserContext } from 'playwright-core';

type SolveResult = { success: boolean; token?: string; error?: string };

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

async function waitForPostLoginReady(page: Page): Promise<boolean> {
  const selectors = [
    'nav[role="navigation"]',
    '[data-testid="global-nav"]',
    '[data-control-name="identity_welcome_message"]'
  ];

  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 3000 });
      return true;
    } catch {
      // continue trying other selectors
    }
  }

  try {
    await page.waitForURL(/linkedin\.com\/feed/, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to solve visible reCAPTCHA v2 using NopeCHA.
 * Requires NOPECHA_API_KEY or NOPECHA_KEY.
 */
async function solveRecaptchaWithNopecha(page: Page): Promise<SolveResult> {
  const apiKey = process.env.NOPECHA_API_KEY || process.env.NOPECHA_KEY;
  if (!apiKey) {
    console.log('   ⚠️  NopeCHA API key not set (NOPECHA_API_KEY), skipping auto-solve');
    return { success: false, error: 'missing_api_key' };
  }

  try {
    const recaptchaIframe = page.locator('iframe[src*="recaptcha"]').first();
    await recaptchaIframe.waitFor({ state: 'attached', timeout: 5000 });
    const src = await recaptchaIframe.getAttribute('src');
    if (!src) {
      return { success: false, error: 'no_iframe_src' };
    }

    const urlObj = new URL(src, 'https://www.linkedin.com');
    const sitekey = urlObj.searchParams.get('k') || urlObj.searchParams.get('sitekey');
    if (!sitekey) {
      console.log('   ⚠️  Could not find reCAPTCHA sitekey');
      return { success: false, error: 'no_sitekey' };
    }

    console.log(`   🤖 Sending reCAPTCHA to NopeCHA (sitekey: ${sitekey.slice(0, 12)}...)`);
    const solveResp = await fetch('https://api.nopecha.com/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: apiKey,
        type: 'recaptcha2',
        sitekey,
        url: page.url()
      })
    });

    if (!solveResp.ok) {
      const text = await solveResp.text().catch(() => '');
      console.log(`   ❌ NopeCHA request failed: ${solveResp.status} ${text}`);
      return { success: false, error: `http_${solveResp.status}` };
    }

    const data = await solveResp.json().catch(() => ({}));
    const token = Array.isArray(data?.data) ? data.data[0] : data?.data;
    if (!token || typeof token !== 'string') {
      console.log('   ❌ NopeCHA did not return a token');
      return { success: false, error: 'no_token' };
    }

    console.log('   ✅ Received token from NopeCHA, injecting into page...');
    await page.evaluate((tokenValue) => {
      const setValue = (el: HTMLTextAreaElement | HTMLInputElement) => {
        el.value = tokenValue;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const candidates = [
        ...Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[name="g-recaptcha-response"], #g-recaptcha-response')),
        ...Array.from(document.querySelectorAll<HTMLInputElement>('input[name="g-recaptcha-response"]'))
      ];

      candidates.forEach(setValue);

      const cfg = (window as any).___grecaptcha_cfg;
      if (cfg?.clients) {
        Object.values(cfg.clients).forEach((client: any) => {
          const cb = client?.callback || client?.V?.callback || client?.W?.callback;
          if (typeof cb === 'function') {
            try {
              cb(tokenValue);
            } catch {
              /* ignore */
            }
          }
        });
      }
    }, token);

    const verifyButton = page.locator('button:has-text("Verify"), button:has-text("Continue"), button:has-text("Submit")').first();
    if (await verifyButton.count().catch(() => 0)) {
      await verifyButton.click({ timeout: 5000 }).catch(() => {});
    }

    return { success: true, token };
  } catch (error: any) {
    console.log(`   ❌ NopeCHA solve error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function executeLoginFlow(page: Page, context: BrowserContext, email: string, password: string): Promise<void> {
  // Always rely on the NopeCHA browser extension (no API key flow)
  const preferNopechaExtensionOnly = true;
  console.log('🔐 Performing login flow...');
  
  // CRITICAL: Check if browser/context/page is still open before navigation
  try {
    console.log('   🔍 Checking browser/context/page state before navigation...');
    console.log(`   📋 Page is closed: ${page.isClosed()}`);
    
    // Verify page is still attached
    if (page.isClosed()) {
      console.error('   ❌ Page is closed before navigation');
      throw new Error('Page is closed before navigation');
    }
    
    // Verify context is still open
    const pages = context.pages();
    console.log(`   📊 Context pages count: ${pages.length}`);
    console.log(`   📋 Page in context: ${pages.includes(page)}`);
    
    if (pages.length === 0 || !pages.includes(page)) {
      console.error('   ❌ Context is closed or page is detached');
      throw new Error('Context is closed or page is detached');
    }
    
    console.log('   ✅ Browser/context/page state verified, navigating to login...');
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('   ✅ Navigation to login page completed');
  } catch (error: any) {
    console.error('   ❌ Error during login navigation:', error.message);
    console.error('   📊 Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    });
    
    if (error.message.includes('closed') || error.message.includes('detached')) {
      console.error('   ❌ Browser/context/page closure detected');
      throw new Error(`Browser/context/page closed before navigation: ${error.message}`);
    }
    throw error;
  }
  console.log('   🌐 Login URL:', page.url());
  console.log('   🏷️  Title:', await page.title());
  await humanPause(2000, 3000);

  await handleAccountPicker(page);

  const emailSelector = 'input[aria-label="Email or phone"], input[name="session_key"]';
  console.log('   🎯 Filling email via selector:', emailSelector);
  await fillInputValue(page, emailSelector, email);
  await humanPause(500, 1000);

  const passwordSelector = 'input[aria-label="Password"], input[name="session_password"]';
  console.log('   🛡️ Filling password via selector:', passwordSelector);
  await fillInputValue(page, passwordSelector, password);
  await humanPause(500, 1000);

  const loginButtonSelectors = [
    'button[type="submit"]',
    'form button[type="submit"]',
    'button[type="submit"]:not(:has-text("Apple")):not(:has-text("Google"))'
  ];

  let loginButton: Locator | null = null;
  for (const selector of loginButtonSelectors) {
    const btn = page.locator(selector).first();
    const count = await btn.count();
    if (count > 0) {
      const text = await btn.textContent().catch(() => '');
      if (!text || text.trim().toLowerCase().includes('sign in')) {
        loginButton = btn;
        console.log(`   ✅ Found login button with selector: ${selector}`);
        break;
      }
    }
  }

  if (!loginButton) {
    loginButton = page.getByRole('button', { name: 'Sign in', exact: true }).first();
    const total = await loginButton.count();
    if (total === 0) {
      throw new Error('Login button not found');
    }
  }

  await loginButton.click();
  console.log('   🖱️  Clicked login button, waiting for response...');
  
  // Wait for navigation or any redirects
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  } catch (e) {
    console.log('   ⚠️  Network idle timeout, continuing...');
  }
  
  await humanPause(3000, 5000);

  // Check current URL - reCAPTCHA appears on challenge/checkpoint pages
  const currentUrl = page.url();
  const isOnChallengePage = currentUrl.includes('/challenge') || currentUrl.includes('/checkpoint');
  
  // Check for reCAPTCHA checkbox and click it (only on challenge pages)
  // Declare isImageChallenge at function scope so it's accessible later
  let isImageChallenge = false;
  
  if (isOnChallengePage) {
    console.log('   🔍 Checking for reCAPTCHA challenge on security page...');
    console.log(`   🌐 Current URL: ${currentUrl}`);
    
    // Wait longer for reCAPTCHA to load (it can take a few seconds)
    console.log('   ⏳ Waiting for reCAPTCHA to load...');
    
    // Wait for page to be fully loaded and network to be idle
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      console.log('   ✅ Page network idle');
    } catch {
      console.log('   ⚠️  Network idle timeout, continuing...');
    }
    
    // Additional wait for CAPTCHA iframe to actually load content
    await humanPause(5000, 7000);
    
    // Wait for any loading spinners to disappear
    try {
      await page.waitForFunction(
        () => {
          // Check if there are any visible spinners/loaders
          const spinners = document.querySelectorAll('[class*="spinner"], [class*="loading"], [class*="loader"], [aria-busy="true"]');
          return Array.from(spinners).every(el => {
            const style = window.getComputedStyle(el);
            return style.display === 'none' || style.visibility === 'hidden' || !el.checkVisibility();
          });
        },
        { timeout: 10000 }
      );
      console.log('   ✅ Loading spinners cleared');
    } catch {
      console.log('   ⚠️  Spinner check timeout, continuing...');
    }
    
    // Check page content for reCAPTCHA indicators AND determine challenge type FIRST
    const challengePageText = await page.textContent('body').catch(() => '') || '';
    const hasSecurityCheckText = challengePageText.includes("Let's do a quick security check") || 
                                  challengePageText.includes('security check') ||
                                  challengePageText.includes('I\'m not a robot');
    console.log(`   📄 Page contains security check text: ${hasSecurityCheckText}`);
    
    // Wait a bit more for challenge content to load (image challenges load after spinners clear)
    await humanPause(5000, 7000); // Wait longer for challenge content
    
    // Re-check page text after waiting (content may load dynamically)
    // The challenge text might appear after iframe loads
    let updatedPageText = await page.textContent('body').catch(() => '') || '';
    let finalChallengeText = updatedPageText || challengePageText;
    
    // If page text is still very short, wait more and check again
    if (finalChallengeText.length < 200) {
      console.log(`   ⏳ Page text is short (${finalChallengeText.length} chars), waiting for challenge content...`);
      await humanPause(5000, 7000);
      updatedPageText = await page.textContent('body').catch(() => '') || '';
      finalChallengeText = updatedPageText || challengePageText;
      console.log(`   📄 Re-checked page text: ${finalChallengeText.length} chars`);
    }
    
    // Check if this is an image selection challenge (text is on main page, not in iframe)
    // This MUST be detected early before we try to interact with iframe
    // LinkedIn may use bold formatting (**traffic lights**) which gets stripped
    const challengeTextLower = finalChallengeText.toLowerCase();
    const isImageChallengeOnPage = challengeTextLower.includes('select all squares with') ||
                                    challengeTextLower.includes('select all squares') ||
                                    challengeTextLower.includes('click all images with') ||
                                    challengeTextLower.includes('click all images') ||
                                    challengeTextLower.includes('traffic lights') ||
                                    challengeTextLower.includes('trafficlights') ||
                                    challengeTextLower.includes('crosswalks') ||
                                    challengeTextLower.includes('fire hydrants') ||
                                    challengeTextLower.includes('firehydrants') ||
                                    challengeTextLower.includes('buses') ||
                                    challengeTextLower.includes('mountains') ||
                                    challengeTextLower.includes('select all images') ||
                                    challengeTextLower.includes('select all images with') ||
                                    challengeTextLower.includes('select all boxes') ||
                                    // Check for grid of images (3x3, 4x4, etc.) - indicates image challenge
                                    (challengeTextLower.includes('square') && challengeTextLower.includes('with')) ||
                                    // Check for SKIP button text - indicates image challenge
                                    (challengeTextLower.includes('skip') && challengeTextLower.includes('squares'));
    
    // Also check for visual indicators: image grid, SKIP button, etc.
    // Check for SKIP button first (strong indicator of image challenge)
    const hasSkipButton = await page.locator('button:has-text("Skip"), button:has-text("SKIP"), [aria-label*="Skip" i], button[type="button"]:has-text(/skip/i)').count().catch(() => 0) > 0;
    
    // Check for image grid (multiple images in a grid layout)
    const hasImageGrid = await page.locator('img[alt*="square"], img[alt*="image"], [class*="grid"], [class*="tile"], img[src*="captcha"], [class*="challenge-image"]').count().catch(() => 0) > 9; // Usually 9+ images in a grid
    
    // Check for challenge-specific elements
    const hasChallengeGrid = await page.locator('[class*="challenge"], [class*="captcha"], [data-testid*="challenge"]').count().catch(() => 0) > 0;
    
    const hasImageChallengeText = finalChallengeText.length > 100 && (
      challengeTextLower.includes('square') ||
      challengeTextLower.includes('image') ||
      challengeTextLower.includes('select')
    );
    
    // Combine text and visual indicators (update the outer scope variable)
    // SKIP button is a strong indicator of image challenge
    // Image grid with challenge text is also a strong indicator
    isImageChallenge = isImageChallengeOnPage || 
                       hasSkipButton ||  // SKIP button = image challenge
                       (hasImageGrid && hasImageChallengeText) || 
                       (hasChallengeGrid && hasImageChallengeText);
    
    // Debug: Show what text we found (for troubleshooting)
    if (finalChallengeText.length > 0) {
      const relevantText = finalChallengeText.substring(0, 800).replace(/\s+/g, ' ').trim();
      console.log(`   📄 Page text preview (${relevantText.length} chars): ${relevantText.substring(0, 300)}...`);
    }
    
    console.log(`   🔍 Detection results: hasImageGrid=${hasImageGrid}, hasSkipButton=${hasSkipButton}, hasChallengeGrid=${hasChallengeGrid}, textMatch=${isImageChallengeOnPage}`);
    
    // Update the outer scope variable (already declared above at function scope)
    isImageChallenge = isImageChallengeOnPage || (hasImageGrid && hasImageChallengeText) || hasSkipButton;
    
    if (preferNopechaExtensionOnly) {
      // Skip manual handling; rely on extension
      console.log('   ⏳ Waiting for extension to solve the challenge (no manual clicks)...');
    } else if (isImageChallenge) {
      console.log('   🖼️  Image selection challenge detected on main page!');
      console.log('   🤖 NopeCHA should automatically solve this (may take 10-30 seconds)...');
      if (hasSkipButton) {
        console.log('   ✅ SKIP button found - confirms image challenge');
      }
      if (hasImageGrid) {
        console.log('   ✅ Image grid detected - confirms image challenge');
      }
    } else {
      console.log(`   📄 Challenge type: Checkbox (no image challenge indicators found)`);
      // Show a sample of the text for debugging
      if (finalChallengeText.length > 0) {
        console.log(`   🔍 Searched for: "traffic lights", "select all squares", "select all images", etc.`);
      }
    }
    
    // Check for reCAPTCHA iframe first (most reliable indicator)
    // Wait specifically for iframe to appear
    let recaptchaIframe = null;
    const iframeSelectors = [
      'iframe[src*="recaptcha"]',
      'iframe[src*="google.com/recaptcha"]',
      'iframe[title*="reCAPTCHA"]',
      'iframe[title*="recaptcha"]',
      'iframe[title*="recaptcha" i]',
      'iframe[name*="recaptcha" i]',
      'iframe[role="presentation"]',
      'iframe'
    ];
    
    console.log('   🔍 Looking for reCAPTCHA iframe...');
    for (const selector of iframeSelectors) {
      try {
        // Wait for iframe to be available
        const iframe = page.locator(selector).first();
        const count = await iframe.count();
        console.log(`   🔎 Checking selector "${selector}": found ${count} elements`);
        
        if (count > 0) {
          // Check if it's visible and get its src to verify it's reCAPTCHA
          const isVisible = await iframe.isVisible().catch(() => false);
          if (isVisible) {
            try {
              const src = await iframe.getAttribute('src').catch(() => '');
              const title = await iframe.getAttribute('title').catch(() => '');
              console.log(`   📋 Iframe src: ${src?.substring(0, 100)}...`);
              console.log(`   📋 Iframe title: ${title}`);
              
              if (src?.includes('recaptcha') || title?.toLowerCase().includes('recaptcha')) {
                console.log(`   ✅ Found reCAPTCHA iframe: ${selector}`);
                recaptchaIframe = iframe;
                break;
              } else if (selector === 'iframe' && hasSecurityCheckText) {
                // If we're on security check page and found an iframe, it's likely reCAPTCHA
                console.log(`   ✅ Likely reCAPTCHA iframe (on security page): ${selector}`);
                recaptchaIframe = iframe;
                break;
              }
            } catch (e) {
              // Continue checking
            }
          }
        }
      } catch (e: any) {
        console.log(`   ⚠️  Error checking selector "${selector}": ${e.message}`);
      }
    }
    
    // Also check for reCAPTCHA text on page
    const hasRecaptchaText = await page.locator('text=/I\'m not a robot/i, text=/reCAPTCHA/i, text=/security check/i').count().catch(() => 0) > 0;
    console.log(`   📄 Page has reCAPTCHA text: ${hasRecaptchaText}`);
    
    // Fallback: If we have security check text but no iframe found, try finding all iframes
    if (!recaptchaIframe && hasSecurityCheckText) {
      console.log('   🔄 Security check text found but no iframe detected, checking all iframes...');
      try {
        const allIframes = page.locator('iframe');
        const iframeCount = await allIframes.count();
        console.log(`   📊 Found ${iframeCount} total iframes on page`);
        
        for (let i = 0; i < Math.min(iframeCount, 5); i++) {
          try {
            const iframe = allIframes.nth(i);
            const isVisible = await iframe.isVisible().catch(() => false);
            if (isVisible) {
              const src = await iframe.getAttribute('src').catch(() => '');
              const title = await iframe.getAttribute('title').catch(() => '');
              console.log(`   🔍 Iframe ${i}: src="${src?.substring(0, 80)}...", title="${title}"`);
              
              // If it's from google.com or has recaptcha in src/title, it's likely reCAPTCHA
              if (src?.includes('google.com') || src?.includes('recaptcha') || 
                  title?.toLowerCase().includes('recaptcha')) {
                console.log(`   ✅ Found reCAPTCHA iframe (fallback method): iframe ${i}`);
                recaptchaIframe = iframe;
                break;
              }
            }
          } catch (e) {
            // Continue
          }
        }
      } catch (e: any) {
        console.warn(`   ⚠️  Error checking all iframes: ${e.message}`);
      }
    }
  
  // Determine challenge type early (from main page text) - use the variable we already declared
  // Use the combined detection result
  if (recaptchaIframe || hasRecaptchaText || hasSecurityCheckText) {
    let checkboxClicked = false;
    let solvedByNopecha = false;
    
    // Extension-only mode: let the NopeCHA browser extension handle it without API
    if (preferNopechaExtensionOnly) {
      console.log('   🧩 NopeCHA extension-only mode enabled (NOPECHA_EXTENSION_ONLY=true)');
      console.log('   ⏳ Waiting for the extension to solve automatically; skipping manual clicks and API calls');
      solvedByNopecha = true;
      checkboxClicked = true; // enter wait loop below
    } else {
      // Try NopeCHA API first for both checkbox and image challenges
      try {
        const solveResult = await solveRecaptchaWithNopecha(page);
        if (solveResult.success) {
          solvedByNopecha = true;
          checkboxClicked = true;
          console.log('   ✅ NopeCHA token applied; waiting briefly for validation...');
          await humanPause(3000, 5000);
        } else if (solveResult.error === 'missing_api_key') {
          console.log('   ⚠️  NopeCHA not configured; continuing with manual fallback');
        } else {
          console.log(`   ⚠️  NopeCHA could not solve automatically (${solveResult.error || 'unknown error'}), falling back to manual clicks`);
        }
      } catch (e: any) {
        console.log(`   ⚠️  NopeCHA solve attempt threw an error: ${e.message}`);
      }
    }
    
    if (isImageChallenge) {
      console.log('   🖼️  Image selection challenge detected!');
      console.log('   🤖 NopeCHA will automatically solve this (may take 10-30 seconds)...');
      console.log('   ⏸️  Skipping checkbox clicking - NopeCHA handles image challenges automatically');
      // Don't try to click checkbox for image challenges - NopeCHA will handle it
      checkboxClicked = false;
    } else {
      console.log('   🤖 Checkbox CAPTCHA detected! Attempting to click checkbox...');
      
      // Method 1: Try to click inside the iframe (most reliable)
      if (recaptchaIframe && !solvedByNopecha) {
      try {
        console.log('   🔄 Accessing CAPTCHA iframe...');
        // Get the actual Frame object from the iframe element handle
        const iframeElement = await recaptchaIframe.elementHandle();
        if (!iframeElement) {
          throw new Error('Could not get iframe element handle');
        }
        
        const frame = await iframeElement.contentFrame();
        if (frame) {
          console.log('   ✅ Iframe accessed, waiting for content to load...');
          
          // Wait for iframe to be fully loaded
          try {
            await frame.waitForLoadState('domcontentloaded', { timeout: 15000 });
            console.log('   ✅ Iframe DOM content loaded');
          } catch {
            console.log('   ⚠️  Iframe DOM load timeout, continuing...');
          }
          
          // Wait for iframe network to be idle
          try {
            await frame.waitForLoadState('networkidle', { timeout: 15000 });
            console.log('   ✅ Iframe network idle');
          } catch {
            console.log('   ⚠️  Iframe network idle timeout, continuing...');
          }
          
          // Additional wait for CAPTCHA content to render
          await humanPause(5000, 7000);
          
          // Check if iframe has actual content (not just spinner)
          const hasContent = await frame.evaluate(() => {
            const body = document.body;
            if (!body) return false;
            
            // Check if body has meaningful content (not just empty/spinner)
            const text = body.textContent || '';
            const hasText = text.trim().length > 10;
            
            // Check for visible elements
            const visibleElements = Array.from(body.querySelectorAll('*')).filter(el => {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return style.display !== 'none' && 
                     style.visibility !== 'hidden' && 
                     rect.width > 0 && 
                     rect.height > 0;
            });
            
            return hasText || visibleElements.length > 0;
          });
          
          if (!hasContent) {
            console.log('   ⚠️  Iframe appears to be empty or still loading, waiting longer...');
            await humanPause(5000, 7000);
          } else {
            console.log('   ✅ Iframe has content');
          }
          
          // Re-check main page text AFTER iframe loads (challenge text might appear now)
          await humanPause(5000, 7000); // Give it more time for challenge to render and NopeCHA to detect
          const mainPageTextAfterIframe = await page.textContent('body').catch(() => '') || '';
          if (mainPageTextAfterIframe.length > 200) {
            console.log(`   📄 Main page text updated after iframe load: ${mainPageTextAfterIframe.length} chars`);
            const updatedTextLower = mainPageTextAfterIframe.toLowerCase();
            
            // Show a sample of the text for debugging
            const textSample = mainPageTextAfterIframe.substring(0, 500).replace(/\s+/g, ' ').trim();
            console.log(`   📋 Text sample: ${textSample.substring(0, 200)}...`);
            
            // Re-check for image challenge keywords (more variations)
            const hasTrafficLights = updatedTextLower.includes('traffic lights') || updatedTextLower.includes('trafficlights') || updatedTextLower.includes('traffic light');
            const hasSelectAllSquares = updatedTextLower.includes('select all squares') || updatedTextLower.includes('select all squares with') || updatedTextLower.includes('select all square');
            const hasSelectAllImages = updatedTextLower.includes('select all images') || updatedTextLower.includes('select all image');
            const hasClickAll = updatedTextLower.includes('click all images') || updatedTextLower.includes('click all squares');
            
            // Re-check for SKIP button (might appear after iframe loads)
            const hasSkipButtonNow = await page.locator('button:has-text("Skip"), button:has-text("SKIP"), [aria-label*="Skip" i], button:has-text(/skip/i)').count().catch(() => 0) > 0;
            
            // Check for image grid on main page
            const hasImageGridNow = await page.locator('img[alt*="square"], img[alt*="image"], [class*="grid"], [class*="tile"]').count().catch(() => 0) > 9;
            
            console.log(`   🔍 Re-check results: trafficLights=${hasTrafficLights}, selectAllSquares=${hasSelectAllSquares}, selectAllImages=${hasSelectAllImages}, clickAll=${hasClickAll}, skipButton=${hasSkipButtonNow}, imageGrid=${hasImageGridNow}`);
            
            if (hasTrafficLights || hasSelectAllSquares || hasSelectAllImages || hasClickAll || hasSkipButtonNow || hasImageGridNow) {
              console.log('   🖼️  Image challenge detected in updated page text!');
              isImageChallenge = true; // Update the outer scope variable
              console.log('   ⏸️  Skipping checkbox clicking - this is an image challenge');
              console.log('   🤖 NopeCHA should automatically solve this (may take 10-30 seconds)...');
            }
          }
          
          // Check iframe src to determine CAPTCHA type
          const iframeSrc = await recaptchaIframe.getAttribute('src').catch(() => '');
          const isLinkedInCaptcha = iframeSrc?.includes('linkedin.com') || iframeSrc?.includes('captchaInternal');
          const isGoogleRecaptcha = iframeSrc?.includes('google.com/recaptcha') || iframeSrc?.includes('recaptcha');
          
          console.log(`   📋 CAPTCHA type: ${isLinkedInCaptcha ? 'LinkedIn Internal' : isGoogleRecaptcha ? 'Google reCAPTCHA' : 'Unknown'}`);
          
          // Detect challenge type: checkbox or image selection
          const challengeType = await frame.evaluate(() => {
            const bodyText = document.body?.textContent?.toLowerCase() || '';
            const hasImages = document.querySelectorAll('img, canvas').length > 0;
            const hasCheckbox = document.querySelector('input[type="checkbox"], [role="checkbox"]') !== null;
            const hasImageChallenge = bodyText.includes('select all') || 
                                      bodyText.includes('click all') ||
                                      bodyText.includes('images with') ||
                                      bodyText.includes('traffic lights') ||
                                      bodyText.includes('crosswalks') ||
                                      bodyText.includes('fire hydrants') ||
                                      bodyText.includes('buses') ||
                                      bodyText.includes('mountains') ||
                                      (hasImages && bodyText.length > 100);
            
            if (hasCheckbox && !hasImageChallenge) {
              return 'checkbox';
            } else if (hasImageChallenge) {
              return 'image_selection';
            } else {
              return 'unknown';
            }
          });
          
          console.log(`   🎯 Challenge type detected: ${challengeType}`);
          
          if (challengeType === 'image_selection') {
            console.log('   🖼️  Image selection challenge detected!');
            console.log('   💡 This requires selecting specific images (e.g., "click all images with traffic lights")');
            console.log('   ⚠️  Image selection challenges are difficult to automate');
            console.log('   💡 Options:');
            console.log('      1. Use a CAPTCHA solving service (2Captcha, etc.)');
            console.log('      2. Complete manually in headed mode');
            console.log('      3. The automation will wait for manual completion...');
            
            // For image selection, we'll wait for manual completion
            // In the future, we could integrate a CAPTCHA solving service here
            checkboxClicked = false; // Mark as not clicked, will wait for manual
          } else {
            // Only try checkbox methods if it's a checkbox challenge
            console.log('   ☑️  Checkbox challenge - attempting to click...');
            // LinkedIn CAPTCHA selectors (different from Google reCAPTCHA)
            const linkedinCheckboxSelectors = [
              'input[type="checkbox"]',
              '[role="checkbox"]',
              'label',
              '.checkbox',
              '[class*="checkbox"]',
              'button[type="button"]',
              'div[role="button"]',
              'span[role="button"]'
            ];
          
            // Google reCAPTCHA selectors
            const googleRecaptchaSelectors = [
              '#recaptcha-anchor',
              '.recaptcha-checkbox',
              '.recaptcha-checkbox-border',
              'span.recaptcha-checkbox',
              'div.recaptcha-checkbox',
              '.rc-anchor-checkbox',
              '#recaptcha-anchor > div'
            ];
            
            // Use appropriate selectors based on CAPTCHA type
            const checkboxSelectors = isLinkedInCaptcha ? linkedinCheckboxSelectors : 
                                      isGoogleRecaptcha ? googleRecaptchaSelectors :
                                      [...linkedinCheckboxSelectors, ...googleRecaptchaSelectors];
            
            console.log(`   🔍 Trying ${checkboxSelectors.length} checkbox selectors...`);
            
            // Method 1: Use evaluate to find and click checkbox (most reliable for LinkedIn CAPTCHA)
            if (!checkboxClicked) {
            try {
              console.log('   🔄 Using evaluate to find and click checkbox...');
              
              // First, debug what's actually in the iframe
              const iframeDebug = await frame.evaluate(() => {
                const debug: any = {
                  html: document.documentElement.outerHTML.substring(0, 500),
                  bodyText: document.body?.textContent?.substring(0, 200) || '',
                  allInputs: Array.from(document.querySelectorAll('input')).map(i => ({
                    type: i.type,
                    id: i.id,
                    className: i.className,
                    visible: i.offsetParent !== null
                  })),
                  allButtons: Array.from(document.querySelectorAll('button')).map(b => ({
                    text: b.textContent?.substring(0, 50),
                    className: b.className,
                    visible: b.offsetParent !== null
                  })),
                  allClickable: Array.from(document.querySelectorAll('[role="button"], [role="checkbox"], label, button')).map(el => ({
                    tag: el.tagName,
                    role: el.getAttribute('role'),
                    text: el.textContent?.substring(0, 50),
                    className: el.className,
                    visible: (el as HTMLElement).offsetParent !== null
                  }))
                };
                return debug;
              });
              
              console.log('   📋 Iframe debug info:');
              console.log(`   📄 Body text preview: ${iframeDebug.bodyText}`);
              console.log(`   🔘 Found ${iframeDebug.allInputs.length} inputs`);
              console.log(`   🔘 Found ${iframeDebug.allButtons.length} buttons`);
              console.log(`   🔘 Found ${iframeDebug.allClickable.length} clickable elements`);
              
              if (iframeDebug.allInputs.length > 0) {
                console.log(`   📋 Inputs: ${JSON.stringify(iframeDebug.allInputs)}`);
              }
              if (iframeDebug.allButtons.length > 0) {
                console.log(`   📋 Buttons: ${JSON.stringify(iframeDebug.allButtons)}`);
              }
              
              const clicked = await frame.evaluate(() => {
                const isVisible = (el: Element) => {
                  const style = window.getComputedStyle(el);
                  const rect = (el as HTMLElement).getBoundingClientRect();
                  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                };
                
                // Recursively search shadow DOM for clickable elements
                const searchShadow = (root: ShadowRoot | Document | Element): HTMLElement | null => {
                  const walker = (root instanceof ShadowRoot || root instanceof Document)
                    ? root
                    : (root as Element).shadowRoot;
                  if (!walker) return null;
                  
                  const candidates = Array.from(walker.querySelectorAll<HTMLElement>('input[type="checkbox"], [role="checkbox"], button, [role="button"], label, div[onclick], span[onclick]'));
                  const hit = candidates.find(el => isVisible(el));
                  if (hit) return hit;
                  
                  const all = Array.from(walker.querySelectorAll('*'));
                  for (const el of all) {
                    if ((el as Element).shadowRoot) {
                      const found = searchShadow(el as Element);
                      if (found) return found;
                    }
                  }
                  return null;
                };
                
                // Look for checkbox input first
                const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
                if (checkbox && checkbox.offsetParent !== null) { // Check if visible
                  checkbox.click();
                  return { success: true, method: 'input[type="checkbox"]' };
                }
                
                // Look for checkbox role
                const checkboxRole = document.querySelector('[role="checkbox"]') as HTMLElement;
                if (checkboxRole && checkboxRole.offsetParent !== null) {
                  checkboxRole.click();
                  return { success: true, method: '[role="checkbox"]' };
                }
                
                // Look for "I'm not a robot" text and click nearby
                const allElements = Array.from(document.querySelectorAll('*'));
                const robotText = allElements.find(el => {
                  const text = el.textContent || '';
                  return text.includes("I'm not a robot") || 
                         text.includes('I am not a robot') ||
                         text.includes("I'm not a robot") ||
                         text.toLowerCase().includes('not a robot');
                }) as HTMLElement;
                
                if (robotText) {
                  // Find parent or nearby clickable element
                  const clickable = robotText.closest('label') || 
                                 robotText.closest('div[role="button"]') ||
                                 robotText.closest('button') ||
                                 robotText.previousElementSibling as HTMLElement ||
                                 robotText.parentElement;
                  
                  if (clickable) {
                    (clickable as HTMLElement).click();
                    return { success: true, method: 'text-based click' };
                  }
                  
                  // If no clickable parent, try clicking the text element itself
                  robotText.click();
                  return { success: true, method: 'direct text click' };
                }
                
                // Look inside shadow DOM for clickable items
                const shadowClickable = searchShadow(document);
                if (shadowClickable) {
                  shadowClickable.click();
                  return { success: true, method: 'shadow-dom clickable' };
                }
                
                // Look for any visible button or clickable element
                const visibleClickable = Array.from(document.querySelectorAll('button, [role="button"], [role="checkbox"], label, div[onclick], span[onclick]')).find(el => {
                  const style = window.getComputedStyle(el as Element);
                  return style.display !== 'none' && 
                         style.visibility !== 'hidden' &&
                         (el as HTMLElement).offsetParent !== null;
                }) as HTMLElement;
                
                if (visibleClickable) {
                  visibleClickable.click();
                  return { success: true, method: 'first visible clickable' };
                }
                
                // Last resort: Find any clickable element in the iframe
                const clickableElements = allElements.filter(el => {
                  const style = window.getComputedStyle(el as Element);
                  return style.display !== 'none' && 
                         style.visibility !== 'hidden' &&
                         (el.tagName === 'BUTTON' || 
                          el.getAttribute('role') === 'button' ||
                          el.getAttribute('role') === 'checkbox' ||
                          el.tagName === 'LABEL' ||
                          (el as HTMLElement).onclick !== null);
                }) as HTMLElement[];
                
                if (clickableElements.length > 0) {
                  // Click the first visible clickable element
                  clickableElements[0].click();
                  return { success: true, method: 'first clickable element' };
                }
                
                return { success: false, method: 'none' };
              });
              
              if (clicked.success) {
                console.log(`   ✅ Clicked checkbox via evaluate (${clicked.method})`);
                checkboxClicked = true;
                await humanPause(2000, 3000);
              } else {
                console.log('   ⚠️  Evaluate did not find clickable checkbox');
                console.log('   💡 The iframe content may be different than expected');
              }
            } catch (e: any) {
              console.warn(`   ⚠️  Evaluate click failed: ${e.message}`);
            }
          }
          
          // Method 2: Try using locators with waitForSelector
          if (!checkboxClicked) {
            for (const selector of checkboxSelectors) {
              try {
                console.log(`   🔎 Trying selector: ${selector}`);
                
                // Wait for selector to appear
                try {
                  await frame.waitForSelector(selector, { timeout: 3000, state: 'attached' });
                } catch {
                  // Selector not found, continue
                  continue;
                }
                
                const checkbox = frame.locator(selector).first();
                const count = await checkbox.count();
                console.log(`   📊 Found ${count} elements with selector "${selector}"`);
                
                if (count > 0) {
                  const isVisible = await checkbox.isVisible().catch(() => false);
                  console.log(`   👁️  Element visible: ${isVisible}`);
                  
                  if (isVisible) {
                    console.log(`   ✅ Found checkbox in iframe: ${selector}`);
                    
                    // Try to get bounding box and click center
                    try {
                      const box = await checkbox.boundingBox();
                      if (box) {
                        // Get iframe position to calculate absolute coordinates
                        const iframeBox = await recaptchaIframe.boundingBox();
                        if (iframeBox) {
                          const centerX = iframeBox.x + box.x + box.width / 2;
                          const centerY = iframeBox.y + box.y + box.height / 2;
                          console.log(`   🖱️  Clicking at center: (${centerX}, ${centerY})`);
                          await page.mouse.click(centerX, centerY);
                          console.log('   ✅ Clicked checkbox via mouse click');
                          checkboxClicked = true;
                          break;
                        }
                      }
                    } catch (e) {
                      // Fallback to regular click
                      try {
                        await checkbox.click({ timeout: 5000, force: true });
                        console.log('   ✅ Clicked checkbox');
                        checkboxClicked = true;
                        break;
                      } catch (clickError: any) {
                        console.log(`   ⚠️  Click failed: ${clickError.message}`);
                      }
                    }
                  }
                }
              } catch (e: any) {
                // Continue to next selector
                console.log(`   ⚠️  Selector "${selector}" failed: ${e.message}`);
              }
            }
          }
          
          // Last resort: Click in the center-left of iframe where checkbox usually is (only for checkbox challenges)
          if (!checkboxClicked && (challengeType === 'checkbox' || challengeType === 'unknown')) {
            try {
              console.log('   🔄 Last resort: Clicking in iframe center-left area...');
              const iframeBox = await recaptchaIframe.boundingBox();
              if (iframeBox) {
                // Click in left portion where checkbox usually is (about 25% from left, 50% from top)
                const clickX = iframeBox.x + iframeBox.width * 0.25;
                const clickY = iframeBox.y + iframeBox.height * 0.5;
                console.log(`   🖱️  Clicking at: (${clickX}, ${clickY})`);
                await page.mouse.click(clickX, clickY);
                console.log('   ✅ Clicked in iframe center-left');
                checkboxClicked = true;
                await humanPause(1000, 2000);
              }
            } catch (e: any) {
              console.warn(`   ⚠️  Could not click in iframe: ${e.message}`);
            }
          }
          } // End of else block (checkbox challenge handling - inside iframe)
        }
      } catch (e: any) {
        console.warn(`   ⚠️  Could not access iframe: ${e.message}`);
      }
      } // End of if (recaptchaIframe) for checkbox clicking
    } // End of else block (checkbox challenge handling)
    
    // Method 2: Try clicking on page-level elements (if iframe method failed) - only for checkbox challenges
    if (!checkboxClicked && !isImageChallenge && !preferNopechaExtensionOnly) {
      console.log('   🔄 Trying page-level selectors...');
      const pageSelectors = [
        'text=/I\'m not a robot/i',
        'text=/I\'m not a robot/i',
        '.g-recaptcha',
        '#recaptcha',
        '[data-sitekey]',
        'div:has-text("I\'m not a robot")',
        'span:has-text("I\'m not a robot")'
      ];
      
      for (const selector of pageSelectors) {
        try {
          const element = page.locator(selector).first();
          const count = await element.count();
          if (count > 0) {
            const isVisible = await element.isVisible().catch(() => false);
            if (isVisible) {
              console.log(`   ✅ Found element: ${selector}`);
              
              // Try to get bounding box and click near the checkbox area
              try {
                const box = await element.boundingBox();
                if (box) {
                  // Click slightly to the left where checkbox usually is
                  const clickX = box.x - 30;
                  const clickY = box.y + box.height / 2;
                  console.log(`   🖱️  Clicking near checkbox area: (${clickX}, ${clickY})`);
                  await page.mouse.click(clickX, clickY);
                  console.log('   ✅ Clicked near checkbox via mouse');
                  checkboxClicked = true;
                  await humanPause(2000, 3000);
                  break;
                }
              } catch (e) {
                // Fallback to regular click
                await element.click({ timeout: 5000, force: true });
                console.log('   ✅ Clicked element');
                checkboxClicked = true;
                await humanPause(2000, 3000);
                break;
              }
            }
          }
        } catch (e: any) {
          // Continue
        }
      }
      
      // Last resort: Try clicking on the iframe itself if we found one
      if (!checkboxClicked && recaptchaIframe) {
        try {
          console.log('   🔄 Last resort: Clicking directly on iframe...');
          const iframeBox = await recaptchaIframe.boundingBox();
          if (iframeBox) {
            // Click in the left portion of iframe where checkbox is
            const clickX = iframeBox.x + 30;
            const clickY = iframeBox.y + iframeBox.height / 2;
            console.log(`   🖱️  Clicking on iframe at: (${clickX}, ${clickY})`);
            await page.mouse.click(clickX, clickY);
            console.log('   ✅ Clicked on iframe');
            checkboxClicked = true;
            await humanPause(2000, 3000);
          }
        } catch (e: any) {
          console.warn(`   ⚠️  Could not click on iframe: ${e.message}`);
        }
      }
    }
    
    // Wait for CAPTCHA to be solved (NopeCHA handles both checkbox and image selection)
    // Use the combined image challenge detection (isImageChallenge)
    // Image selection challenges take longer for NopeCHA to solve
    // Give NopeCHA more time - it may need 30-60 seconds for image challenges
    const maxWaitTime = isImageChallenge || preferNopechaExtensionOnly ? 120000 : 60000; // 120s for image/extension, 60s for checkbox
    const checkInterval = 3000; // Check every 3 seconds
    
    if (checkboxClicked || isImageChallenge) {
      console.log(`   ⏳ Waiting for CAPTCHA to be solved (up to ${maxWaitTime/1000}s, NopeCHA may need time)...`);
      if (isImageChallenge) {
        console.log('   🤖 NopeCHA is working on the image selection challenge (traffic lights, etc.)...');
        console.log('   ⏳ This may take 10-30 seconds for NopeCHA to analyze and click the correct images');
      }
      await humanPause(3000, 5000); // Give it time to process
      
      // Wait for CAPTCHA to complete
      let recaptchaCompleted = false;
      const startTime = Date.now();
      
      while (!recaptchaCompleted && (Date.now() - startTime) < maxWaitTime) {
        await humanPause(checkInterval, checkInterval);
        
        // Check if we're still on a challenge page
        const currentUrl = page.url();
        const stillOnChallenge = currentUrl.includes('/challenge') || currentUrl.includes('/checkpoint');
        const hasRecaptcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="captchaInternal"]').count().catch(() => 0) > 0;
        
        if (!stillOnChallenge && !hasRecaptcha) {
          recaptchaCompleted = true;
          console.log('   ✅ CAPTCHA appears to be completed!');
          break;
        }
        
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        // Log progress every 10 seconds
        if (elapsed % 10 === 0 && elapsed > 0) {
          if (isImageChallenge) {
            console.log(`   ⏳ Still waiting... (${elapsed}s elapsed, NopeCHA is solving the image challenge...)`);
          } else {
            console.log(`   ⏳ Still waiting for CAPTCHA... (${elapsed}s elapsed)`);
          }
        }
      }
      
      if (!recaptchaCompleted) {
        console.warn(`   ⚠️  CAPTCHA not completed after ${maxWaitTime/1000}s`);
        if (isImageChallenge) {
          console.warn('   💡 Image selection challenges may take longer for NopeCHA to solve');
          console.warn('   💡 NopeCHA should handle this automatically, but you can complete manually if needed');
          console.warn('   💡 Check the browser window - NopeCHA may still be working on it');
        }
        console.warn('   💡 In headed mode, you can complete it manually in the browser');
      }
    } else {
      console.warn('   ⚠️  Could not find or click reCAPTCHA checkbox');
      console.warn('   💡 You may need to complete it manually in the browser');
      console.warn('   💡 Try clicking the checkbox manually and the automation will continue');
    }
  } else {
    console.log('   ✅ No reCAPTCHA detected on this page');
  }
  } // End of isOnChallengePage check
  
  // Check for security challenges (re-check URL after potential navigation)
  const currentUrlAfterRecaptcha = page.url();
  const pageTitle = await page.title().catch(() => '');
  const securityPageText = await page.textContent('body').catch(() => '') || '';
  
  console.log(`   🌐 Current URL after login click: ${currentUrlAfterRecaptcha}`);
  console.log(`   🏷️  Page title: ${pageTitle}`);
  
  // Check for various LinkedIn security challenges
  const verificationInputCount = await page.locator('input[type="tel"], input[name="pin"], input[aria-label*="code" i], input[aria-label*="verification" i]').count();
  const hasSecurityChallenge = 
    securityPageText.includes('Verify your identity') ||
    securityPageText.includes('Security challenge') ||
    securityPageText.includes('unusual activity') ||
    securityPageText.includes('verify it\'s you') ||
    securityPageText.includes('security check') ||
    currentUrlAfterRecaptcha.includes('/challenge') ||
    currentUrlAfterRecaptcha.includes('/checkpoint') ||
    verificationInputCount > 0;
  
  if (hasSecurityChallenge) {
    console.warn('   ⚠️  LinkedIn security challenge detected!');
    console.warn('   💡 LinkedIn is asking for additional verification:');
    console.warn('      - This could be a CAPTCHA, 2FA code, or phone verification');
    console.warn('      - In headed mode, you can manually complete this');
    console.warn('      - The browser will wait for you to complete it...');
    
    // Check if we're in headed mode by checking if browser is visible
    // In headed mode, we can wait for manual intervention
    const headlessMode = process.env.HEADLESS === 'true' || process.env.HEADLESS === '1';
    const forceHeaded = process.env.HEADLESS === 'false' || process.env.HEADLESS === '0';
    const isHeaded = forceHeaded || (!headlessMode && process.env.NODE_ENV !== 'production');
    
    if (isHeaded) {
      console.log('   ⏳ Waiting up to 120 seconds for manual security challenge completion...');
      console.log('   👀 Please complete the security challenge in the browser window');
      
      // Wait and periodically check if challenge is completed
      let challengeCompleted = false;
      const maxWaitTime = 120000; // 120 seconds
      const checkInterval = 5000; // Check every 5 seconds
      const startTime = Date.now();
      
      while (!challengeCompleted && (Date.now() - startTime) < maxWaitTime) {
        await humanPause(checkInterval, checkInterval);
        
        const currentUrl = page.url();
        const stillOnChallenge = currentUrl.includes('/challenge') || currentUrl.includes('/checkpoint');
        const backToLogin = currentUrl.includes('/login');
        
        if (!stillOnChallenge && !backToLogin) {
          // Challenge appears to be completed - we're on a different page
          challengeCompleted = true;
          console.log('   ✅ Security challenge appears to be completed!');
          break;
        }
        
        if (backToLogin) {
          console.warn('   ⚠️  Redirected back to login - challenge may have failed');
          break;
        }
        
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.log(`   ⏳ Still waiting... (${elapsed}s elapsed, challenge still active)`);
      }
      
      if (!challengeCompleted) {
        const finalUrl = page.url();
        if (finalUrl.includes('/login')) {
          throw new Error('Security challenge not completed - LinkedIn redirected back to login. Please try again or check if account needs manual verification.');
        } else {
          console.warn('   ⚠️  Challenge wait timeout - proceeding cautiously');
        }
      }
    } else {
      throw new Error('Security challenge detected but running in headless mode - cannot complete manually. Please run with HEADLESS=false to complete the challenge.');
    }
  }
  
  // Check if we're still on login page
  const hasLoginForm = await page.locator('input[name="session_key"], .login-form, form[action*="login"]').count() > 0;
  const isOnLoginPage = currentUrl.includes('/login') || hasLoginForm;
  
  if (isOnLoginPage) {
    console.warn('   ⚠️  Still on login page after login attempt');
    console.warn('   💡 Possible reasons:');
    console.warn('      - Invalid credentials');
    console.warn('      - LinkedIn security challenge (check browser)');
    console.warn('      - Account locked or restricted');
    console.warn('      - Datacenter IP detection');
    
    // In headed mode, wait a bit longer to see if user can complete challenge
    const headlessMode = process.env.HEADLESS === 'true' || process.env.HEADLESS === '1';
    const forceHeaded = process.env.HEADLESS === 'false' || process.env.HEADLESS === '0';
    const isHeaded = forceHeaded || (!headlessMode && process.env.NODE_ENV !== 'production');
    
    if (isHeaded) {
      console.log('   ⏳ Waiting 30 more seconds in case of manual intervention needed...');
      await humanPause(30000, 30000);
      
      // Re-check after waiting
      const newUrl = page.url();
      const newHasLoginForm = await page.locator('input[name="session_key"]').count() > 0;
      if (newUrl.includes('/login') || newHasLoginForm) {
        throw new Error('Login failed - still on login page after waiting');
      }
    } else {
      throw new Error('Login failed - redirected back to login page');
    }
  }
  
  // Wait for any redirects to complete
  console.log('   ⏳ Waiting for session to be fully established...');
  await humanPause(5000, 7000);
  
  // Navigate to feed to ensure session is active
  try {
    console.log('   🔍 Verifying session by navigating to feed...');
    await page.goto('https://www.linkedin.com/feed', { waitUntil: 'domcontentloaded', timeout: 5000 });
    await humanPause(2000, 2000); // 2 second wait before navigating to catch-up page
    
    // Double-check we're logged in
    const feedUrl = page.url();
    const feedTitle = await page.title().catch(() => '');
    const stillOnLogin = feedUrl.includes('/login') || await page.locator('input[name="session_key"]').count() > 0;
    
    console.log(`   🌐 Feed URL: ${feedUrl}`);
    console.log(`   🏷️  Feed title: ${feedTitle}`);
    
    if (stillOnLogin) {
      throw new Error('Session not valid - LinkedIn redirected to login');
    }
    
    // Check for feed content to confirm we're logged in
    const hasFeedContent = await page.locator('main, .feed-container, [data-testid="feed-container"], nav[role="navigation"]').count() > 0;
    if (!hasFeedContent) {
      console.warn('   ⚠️  Feed page loaded but no feed content detected');
    }
    
    console.log('   ✅ Session verified - logged in successfully');
  } catch (e: any) {
    console.error('   ❌ Failed to verify session after login:', e.message);
    console.error('   💡 Current page URL:', page.url());
    console.error('   💡 Current page title:', await page.title().catch(() => 'unknown'));
    throw new Error('Login verification failed');
  }

  // Save session state (cookies, localStorage, IndexedDB)
  await context.storageState({ path: getStorageStatePath() });
  
  // Also save sessionStorage separately (Playwright storageState doesn't include it by default)
  try {
    const sessionStorage = await page.evaluate(() => {
      const storage: Record<string, string> = {};
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key) {
          storage[key] = window.sessionStorage.getItem(key) || '';
        }
      }
      return storage;
    });
    
    const storagePath = getStorageStatePath();
    const storageDir = path.dirname(storagePath);
    const sessionStoragePath = path.join(storageDir, 'linkedin.sessionStorage.json');
    
    const fs = await import('fs');
    fs.writeFileSync(sessionStoragePath, JSON.stringify(sessionStorage, null, 2));
    console.log('   💾 Saved sessionStorage separately');
  } catch (e: any) {
    console.warn('   ⚠️  Could not save sessionStorage:', e.message);
  }
  
  console.log('✅ Logged in and saved session');
}

async function loadCatchUpPage(page: Page): Promise<boolean> {
  console.log('📍 Navigating directly to Catch Up page...');
  try {
    // CRITICAL: Check if page is still open before navigation
    console.log('   🔍 Checking page state before navigation...');
    console.log(`   📋 Page is closed: ${page.isClosed()}`);
    
    if (page.isClosed()) {
      console.error('   ❌ Page is closed before navigation to catch-up page');
      throw new Error('Page is closed before navigation to catch-up page');
    }
    
    console.log('   ✅ Page state verified, starting navigation...');
    await page.goto('https://www.linkedin.com/mynetwork/catch-up/all/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('   ✅ Navigation completed');
    await humanPause(500, 800);

    // CRITICAL: Check if page is still open after navigation
    console.log('   🔍 Checking page state after navigation...');
    console.log(`   📋 Page is closed: ${page.isClosed()}`);
    console.log(`   🔗 Current URL: ${page.url()}`);
    
    if (page.isClosed()) {
      console.error('   ❌ Page was closed during navigation to catch-up page');
      throw new Error('Page was closed during navigation to catch-up page');
    }
    
    console.log('   ✅ Page state verified after navigation');

    const landingUrl = page.url();
    const landingTitle = await page.title().catch(() => 'unknown');
    console.log(`   🌐 Catch Up landing URL: ${landingUrl}`);
    console.log(`   🏷️  Catch Up landing Title: ${landingTitle}`);

    const loginBanner = await page.locator('text="Sign in"').count();
    if (landingUrl.includes('/login') || loginBanner > 0) {
      console.warn('   ⚠️  LinkedIn redirected back to login page after catch-up navigation');
      return false;
    }

    const catchUpTab = page.getByRole('tab', { name: /catch up/i }).first();
    if (await catchUpTab.count() > 0) {
      try {
        await catchUpTab.waitFor({ state: 'attached', timeout: 10000 });
        await humanPause(500, 1000);
        const selected = await catchUpTab.getAttribute('aria-selected');
        if (selected !== 'true') {
          console.log('   👆 Catch Up tab detected but not selected; clicking it');
          await catchUpTab.click();
          await humanPause(1000, 2000);
        }
      } catch (tabError: any) {
        console.log('   ⚠️ Unable to interact with Catch Up tab, continuing with page load:', tabError.message);
      }
    }

    const catchUpSelectors = [
      'section:has-text("Catch up")',
      'div:has-text("Catch up")',
      'main button:has-text("Message")',
      'main button[aria-label*="Message"]',
      'main li',
      'main [role="grid"]',
      'main [aria-label*="Catch up"]',
      'main [data-test-list*="catch"]',
      'main div[role="presentation"]',
      'div[data-automation="catch-up-list"]',
      'div[data-test-list="catch-up"]',
      'div[data-automation="catch-up-card"]',
      'div[data-test-id="catch-up-card"]'
    ];

    let contactsList: Locator | null = null;
    for (const selector of catchUpSelectors) {
      const candidate = page.locator(selector).first();
      try {
        await candidate.waitFor({ state: 'visible', timeout: 12000 });
        contactsList = candidate;
        console.log(`   ✅ Catch Up layout detected via "${selector}"`);
        break;
      } catch {
        // Continue to next selector
      }
    }

    if (!contactsList) {
      console.warn('   ⚠️ Unable to detect Catch Up list via expected selectors; failing early');
      return false;
    }

    return true;
  } catch (error: any) {
    console.error('❌ Error navigating to Catch Up page:', error.message);
    
    // Check if the error is due to browser/page being closed
    if (error.message.includes('closed') || error.message.includes('Target page') || error.message.includes('detached')) {
      console.error('   ❌ Browser/page was closed during navigation');
      throw new Error(`Browser closed during catch-up navigation: ${error.message}`);
    }
    
    return false;
  }
}

// Load environment variables
// CRITICAL: override: false ensures job-specific env vars (from queue worker) take precedence
config({ path: path.resolve(process.cwd(), '.env'), override: false });
config({ path: path.resolve(process.cwd(), '.env.local'), override: false });

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
 * Extract first name from LinkedIn catch-up text safely.
 * LinkedIn often shows strings like "Say congrats to Jane Doe for 5 years at X".
 * We strip guidance words and only return a token that looks like a real name.
 */
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

function extractFirstName(fullName: string): string {
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
    if (!/^[A-Za-z][A-Za-z'’\-]*$/.test(part)) return false;
    return part.length >= 2 && part.length <= 30;
  });

  return candidate || '';
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
        try {
          await loadMoreButton.click({ timeout: 5000 });
        } catch {
          console.log('   ⚠️  Click intercepted, trying JS click...');
          await page.evaluate(() => {
            const btn = document.querySelector('button:has-text("Load more"), button:has-text("Show more")') as HTMLElement | null;
            if (btn) btn.click();
          }).catch(() => {});
        }
        await humanPause(1200, 1800);
      }
    } else {
      // Fallback: just scroll window
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await humanPause(1200, 1800);
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
 * Check if page/browser is still valid
 */
function isPageValid(page: Page): boolean {
  try {
    // Check if page is closed
    if (page.isClosed()) {
      return false;
    }
    // Check if context is closed
    if (page.context().browser()?.isConnected() === false) {
      return false;
    }
    return true;
  } catch (e) {
    // If we can't check, assume invalid
    return false;
  }
}

/**
 * Extract contacts from the catch-up tab
 */
async function extractContacts(page: Page, maxContacts: number = 50): Promise<Contact[]> {
  const contacts: Contact[] = [];

  // Check if page is valid before starting
  if (!isPageValid(page)) {
    console.warn('   ⚠️  Page/browser is closed, cannot extract contacts');
    throw new Error('Target page, context or browser has been closed');
  }

  console.log('🔍 Extracting contacts from catch-up tab...');
  
  // Add diagnostic info about current page state
  try {
    const currentUrl = page.url();
    const pageTitle = await page.title().catch(() => 'unknown');
    console.log(`   📍 Current URL: ${currentUrl}`);
    console.log(`   📄 Page title: ${pageTitle.substring(0, 60)}${pageTitle.length > 60 ? '...' : ''}`);
  } catch (diagError) {
    // Ignore diagnostic errors
  }
  
  const messageComposeLinks = page.locator('a[href*="/messaging/compose/"]');
  const messageLinkCount = await messageComposeLinks.count().catch(() => 0);

  console.log(`   ✓ Found ${messageLinkCount} message compose links`);

  if (messageLinkCount === 0) {
    console.warn('   ⚠️  No message compose links found');
    // Additional diagnostic: check if page structure is correct
    try {
      const mainExists = await page.locator('main').count().catch(() => 0);
      const catchUpContainer = await page.locator('[data-automation="catch-up-list"], [data-test-list="catch-up"]').count().catch(() => 0);
      console.log(`   🔍 Diagnostic: Main container=${mainExists > 0 ? '✅' : '❌'}, Catch-up container=${catchUpContainer > 0 ? '✅' : '❌'}`);
    } catch (diagError) {
      // Ignore diagnostic errors
    }
    return contacts;
  }

  // Limit the number of contacts to process at once
  const contactsToProcess = Math.min(messageLinkCount, maxContacts);
  if (messageLinkCount > maxContacts) {
    console.log(`   ℹ️  Limiting extraction to ${maxContacts} contacts (found ${messageLinkCount} total)`);
  }

  for (let i = 0; i < contactsToProcess; i++) {
    // Check if page is still valid before processing each contact
    if (!isPageValid(page)) {
      console.warn(`   ⚠️  Page/browser closed while extracting contacts (at link ${i + 1}), stopping extraction`);
      throw new Error('Target page, context or browser has been closed');
    }

    try {
      const messageLink = messageComposeLinks.nth(i);
      await messageLink.scrollIntoViewIfNeeded().catch(() => {
        throw new Error('Target page, context or browser has been closed');
      });
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

      // Skip only if the page shows "Message sent"
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
 * Enhance LinkedIn's pre-filled message with greeting, profile and company links
 */
function enhanceMessage(
  originalTemplate: string,
  profileUrl: string,
  companyUrl: string,
  profileTemplate: string,
  companyTemplate: string,
  firstName: string = ''
): string {
  // Start with greeting if firstName is provided
  let enhanced = '';
  if (firstName && firstName.trim()) {
    enhanced = `Dear ${firstName.trim()},\n\n`;
  }
  
  // Include LinkedIn's original template (like "Congrats on...")
  enhanced += originalTemplate.trim();
  
  // Replace placeholders in templates
  const profileText = profileTemplate.replace('{profile_url}', profileUrl);
  const companyText = companyTemplate.replace('{company_url}', companyUrl);
  
  // Append our custom links after LinkedIn's template
  if (profileText || companyText) {
    enhanced += '\n\n';
  }
  if (profileText) {
    enhanced += profileText;
  }
  if (companyText) {
    if (profileText) {
      enhanced += '\n\n';
    }
    enhanced += companyText;
  }
  
  return enhanced.trim();
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
    
    // Close any existing message bubbles to avoid mixing conversations
    // BUT: Only close if they're actually open and blocking - don't open the messaging overlay
    try {
      // Check if there's an open messaging overlay dialog first
      const messagingOverlay = page.locator('[role="dialog"][aria-label*="Messaging" i]').first();
      // Give LinkedIn more time to respond; 1s was too aggressive and caused timeouts
      const overlayVisible = await messagingOverlay.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (overlayVisible) {
        console.log('   ⚠️  Messaging overlay is open, closing it...');
        const closeButtons = page.locator('button[aria-label*="Close"][aria-label*="conversation" i], button[aria-label*="Close"][aria-label*="message" i]').first();
        const count = await closeButtons.count();
        if (count > 0) {
          console.log(`   🔄 Closing existing messaging overlay...`);
          
          // CRITICAL: Aggressive blur before clicking close button to prevent Finder popup
          for (let i = 0; i < 10; i++) {
            await page.evaluate(() => {
              if (document.activeElement && document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
              document.body.blur();
              const buttons = document.querySelectorAll('button');
              buttons.forEach((el: any) => {
                if (el && el.blur) el.blur();
              });
              const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
              inputs.forEach((el: any) => {
                if (el && el.blur) el.blur();
              });
              // Blur all focusable elements
              const focusable = document.querySelectorAll('a, button, input, textarea, select, [contenteditable], [tabindex]');
              focusable.forEach((el: any) => {
                if (el && el.blur) el.blur();
              });
            });
            await humanPause(30, 50);
          }
          await humanPause(300, 400);
          
          // CRITICAL: Use synthetic mouse event instead of click() to avoid keyboard events
          await closeButtons.evaluate((el: any) => {
            // Blur everything first
            if (document.activeElement && document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
            document.body.blur();
            
            // Blur all buttons
            const buttons = document.querySelectorAll('button');
            buttons.forEach((btn: any) => {
              if (btn && btn.blur) btn.blur();
            });
            
            // Use synthetic mouse event instead of click()
            const mouseEvent = new MouseEvent('click', {
              view: window,
              bubbles: true,
              cancelable: true,
              buttons: 1
            });
            el.dispatchEvent(mouseEvent);
          });
          
          // CRITICAL: Aggressive blur immediately after clicking close button
          for (let i = 0; i < 10; i++) {
            await page.evaluate(() => {
              if (document.activeElement && document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
              document.body.blur();
              const buttons = document.querySelectorAll('button');
              buttons.forEach((el: any) => {
                if (el && el.blur) el.blur();
              });
              const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
              inputs.forEach((el: any) => {
                if (el && el.blur) el.blur();
              });
              // Blur all focusable elements
              const focusable = document.querySelectorAll('a, button, input, textarea, select, [contenteditable], [tabindex]');
              focusable.forEach((el: any) => {
                if (el && el.blur) el.blur();
              });
            });
            await humanPause(30, 50);
          }
          await humanPause(200, 300);
          
          await humanPause(500, 1000);
        }
      }
    } catch (e) {
      // Ignore errors - overlay might not be open
    }

    // Proceed to send message
    console.log(`   ✅ ${contact.name} has message button - proceeding to send message...`);
    
    // Click message link/button to open dialog
    // Based on browser inspection: message links have href="/messaging/compose/..." and aria-label="Message [Name]: [message]"
    console.log(`   🖱️  Finding and clicking message button for ${contact.name}...`);
    
    // Extract LinkedIn ID from profile URL for matching
    const profileUrlParts = contact.profileUrl.split('/in/');
    const linkedinId = profileUrlParts.length > 1 ? profileUrlParts[1].split('/')[0].split('?')[0] : null;
    
    // Wait for message links to be present on the page (they may load dynamically)
    // Note: Links can have full URLs (https://www.linkedin.com/messaging/compose/...) or relative (/messaging/compose/...)
    console.log(`   🔍 Waiting for message links to be available...`);
    try {
      await page.waitForSelector('a[href*="messaging/compose"]', { timeout: 10000, state: 'attached' });
    } catch (e) {
      console.log(`   ⚠️  Message links not immediately available, continuing anyway...`);
    }
    
    let messageLink: Locator | null = null;
    
    // Always find the button fresh - don't use stored locators as they can become stale
    // CRITICAL: Exclude links that are inside the messaging overlay dialog - only get links from the catch-up list
    // The messaging overlay has a dialog with role="dialog" and aria-label="Messaging"
    // We want links from the main catch-up list, NOT from any overlay
    
    // Strategy 1: Find by aria-label containing contact name (most reliable based on browser inspection)
    // Links have aria-label like "Message Angela (Yusi) Liu: Congrats on..."
    // Exclude links inside messaging overlay dialog
    if (!messageLink && contact.name && contact.name !== 'Unknown') {
      // Find links that are NOT inside the messaging overlay dialog
      const linkByAria = page.locator(`main a[href*="messaging/compose"][aria-label*="${contact.name}"]:not([role="dialog"] a)`).first();
      const nameCount = await linkByAria.count();
      if (nameCount > 0) {
        // Verify it's not inside a dialog
        const isInDialog = await linkByAria.evaluate((el) => {
          return !!el.closest('[role="dialog"]');
        }).catch(() => false);
        
        if (!isInDialog) {
          const isVisible = await linkByAria.isVisible({ timeout: 5000 }).catch(() => false);
          if (isVisible) {
            messageLink = linkByAria;
            console.log(`   ✅ Found message link by aria-label containing name: ${contact.name}`);
          } else {
            console.log(`   ⚠️  Found link by aria-label but it's not visible, trying to scroll into view...`);
            try {
              await linkByAria.scrollIntoViewIfNeeded({ timeout: 3000 });
              await humanPause(500, 800);
              const isVisibleAfterScroll = await linkByAria.isVisible({ timeout: 2000 }).catch(() => false);
              if (isVisibleAfterScroll) {
                messageLink = linkByAria;
                console.log(`   ✅ Found message link by aria-label after scrolling: ${contact.name}`);
              }
            } catch (e) {
              // Continue to next strategy
            }
          }
        }
      }
    }
    
    // Strategy 2: Find by href containing LinkedIn ID (from profile URL)
    // Exclude links inside messaging overlay dialog
    if (!messageLink && linkedinId) {
      const linkById = page.locator(`main a[href*="messaging/compose"][href*="${linkedinId}"]:not([role="dialog"] a)`).first();
      const idCount = await linkById.count();
      if (idCount > 0) {
        // Verify it's not inside a dialog
        const isInDialog = await linkById.evaluate((el) => {
          return !!el.closest('[role="dialog"]');
        }).catch(() => false);
        
        if (!isInDialog) {
          const isVisible = await linkById.isVisible({ timeout: 5000 }).catch(() => false);
          if (isVisible) {
            messageLink = linkById;
            console.log(`   ✅ Found message link by LinkedIn ID: ${linkedinId}`);
          } else {
            // Try scrolling into view
            try {
              await linkById.scrollIntoViewIfNeeded({ timeout: 3000 });
              await humanPause(500, 800);
              const isVisibleAfterScroll = await linkById.isVisible({ timeout: 2000 }).catch(() => false);
              if (isVisibleAfterScroll) {
                messageLink = linkById;
                console.log(`   ✅ Found message link by LinkedIn ID after scrolling: ${linkedinId}`);
              }
            } catch (e) {
              // Continue to next strategy
            }
          }
        }
      }
    }
    
    // Strategy 3: Find by text content containing contact name
    // Exclude links inside messaging overlay dialog
    if (!messageLink && contact.name && contact.name !== 'Unknown') {
      // Try has-text selector (Playwright-specific)
      const linkByText = page.locator(`main a[href*="messaging/compose"]:has-text("${contact.name}")`).first();
      const textCount = await linkByText.count();
      if (textCount > 0) {
        // Verify it's not inside a dialog
        const isInDialog = await linkByText.evaluate((el) => {
          return !!el.closest('[role="dialog"]');
        }).catch(() => false);
        
        if (!isInDialog) {
          const isVisible = await linkByText.isVisible({ timeout: 5000 }).catch(() => false);
          if (isVisible) {
            messageLink = linkByText;
            console.log(`   ✅ Found message link by text containing name: ${contact.name}`);
          }
        }
      }
    }
    
    // Strategy 4: Fallback to first visible message link from main content (NOT from overlay)
    if (!messageLink) {
      // Get all links from main content area, excluding any in dialogs
      const allLinks = page.locator(`main a[href*="messaging/compose"]`);
      const totalCount = await allLinks.count();
      console.log(`   🔍 Found ${totalCount} total message compose links in main content`);
      
      // Try to find first visible one that's NOT in a dialog
      for (let i = 0; i < Math.min(totalCount, 10); i++) {
        const link = allLinks.nth(i);
        
        // Verify it's not inside a dialog
        const isInDialog = await link.evaluate((el) => {
          return !!el.closest('[role="dialog"]');
        }).catch(() => false);
        
        if (!isInDialog) {
          const isVisible = await link.isVisible({ timeout: 2000 }).catch(() => false);
          if (isVisible) {
            messageLink = link;
            console.log(`   ⚠️  Using message link #${i + 1} as fallback`);
            break;
      } else {
            // Try scrolling into view
            try {
              await link.scrollIntoViewIfNeeded({ timeout: 2000 });
        await humanPause(300, 500);
              const isVisibleAfterScroll = await link.isVisible({ timeout: 2000 }).catch(() => false);
              if (isVisibleAfterScroll) {
                messageLink = link;
                console.log(`   ⚠️  Using message link #${i + 1} after scrolling as fallback`);
                break;
              }
            } catch (e) {
              // Continue to next link
            }
          }
        }
      }
    }
    
    if (!messageLink) {
      throw new Error(`Could not find message link for ${contact.name} (tried multiple strategies)`);
    }
    
    // CRITICAL: Verify the link is actually for THIS contact before clicking
    // CRITICAL: Blur before accessing link attributes to prevent Finder popup
    console.log(`   🔍 Verifying message link is for ${contact.name}...`);
    
    // Blur before getting link attributes
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      document.body.blur();
    });
    await humanPause(100, 200);
    
    // Get link attributes using evaluate to avoid triggering events
    const linkInfo = await messageLink.evaluate((el: any) => {
      return {
        href: el.getAttribute('href') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        textContent: el.textContent?.trim() || ''
      };
    }).catch(() => ({ href: '', ariaLabel: '', textContent: '' }));
    
    const href = linkInfo.href;
    const linkAriaLabel = linkInfo.ariaLabel;
    const linkText = linkInfo.textContent;
    
    console.log(`   🔗 Link href: ${href.substring(0, 100)}...`);
    console.log(`   🔗 Link aria-label: ${linkAriaLabel?.substring(0, 100) || 'none'}...`);
    
    // Blur again after getting attributes
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      document.body.blur();
    });
    await humanPause(100, 200);
    
    // VERIFY: Check that this link is actually for the contact we're processing
    if (contact.name && contact.name !== 'Unknown') {
      const linkContainsName = 
        (linkAriaLabel && linkAriaLabel.includes(contact.name)) ||
        (linkText && linkText.includes(contact.name)) ||
        (href && href.includes(contact.name.split(' ')[0])); // Check first name in URL
      
      if (!linkContainsName) {
        console.error(`   ❌ ERROR: Message link does not match contact name!`);
        console.error(`      Contact: ${contact.name}`);
        console.error(`      Link aria-label: ${linkAriaLabel || 'none'}`);
        console.error(`      Link text: ${linkText || 'none'}`);
        throw new Error(`Message link found but does not match contact "${contact.name}" - wrong link detected!`);
      }
      console.log(`   ✅ Verified link is for ${contact.name}`);
    }
    
    // Also verify the link contains the LinkedIn ID if we have it
    if (linkedinId && href) {
      if (!href.includes(linkedinId)) {
        console.warn(`   ⚠️  Link href does not contain LinkedIn ID ${linkedinId}, but continuing...`);
      } else {
        console.log(`   ✅ Verified link contains LinkedIn ID`);
      }
    }
    
    // Close any open messaging dialogs to avoid switching context
    console.log('   🔒 Closing existing message dialogs before opening a new one...');
    try {
      const closeButtons = page.locator(
        [
          '.msg-overlay-conversation-bubble button[aria-label*=\"Dismiss\" i]',
          '.msg-overlay-conversation-bubble button[aria-label*=\"Close\" i]',
          '.msg-overlay-conversation-bubble button[aria-label*=\"Minimize\" i]',
          '.msg-overlay-conversation-bubble button.msg-overlay-bubble-header__control',
          '.msg-overlay-bubble-header__details button.msg-overlay-bubble-header__control',
          '[role=\"dialog\"] button[aria-label*=\"Close\" i]',
        ].join(', ')
      );
      const count = await closeButtons.count();
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const btn = closeButtons.nth(i);
          const visible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
          if (!visible) continue;
          // Try direct click; if it has a child SVG or text, click center
          try {
            await btn.click({ timeout: 5000 });
          } catch {
            const box = await btn.boundingBox().catch(() => null);
            if (box) {
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            }
          }
          await humanPause(150, 250);
        }
      }
      await humanPause(200, 300);
    } catch (e) {
      console.log('   ⚠️  Could not close dialogs, continuing...');
    }
    
    // Ensure no other message links are focused/hovered
    console.log('   🔒 Ensuring no other message links are active...');
    try {
      await page.evaluate(() => {
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      });
      await humanPause(200, 300);
    } catch (e) {
      // Ignore
    }
    // Ensure element is visible and ready - but DON'T scroll if it causes issues
    // Instead, just check if it's visible and click it
    const isLinkVisible = await messageLink.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isLinkVisible) {
      console.log('   ⚠️  Link not visible, trying scrollIntoViewIfNeeded...');
      await messageLink.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await humanPause(500, 800);
      } else {
      console.log('   ✅ Link is already visible, no scrolling needed');
    }
    
    // Wait for element to be actionable
    try {
      await messageLink.waitFor({ state: 'visible', timeout: 10000 });
    } catch (e) {
      console.log(`   ⚠️  Element not visible, trying anyway...`);
    }
    
    // CRITICAL: Verify we're still on the correct link after any scrolling
    const hrefAfterScroll = await messageLink.getAttribute('href').catch(() => '');
    const ariaLabelAfterScroll = await messageLink.getAttribute('aria-label').catch(() => '');
    if (contact.name && contact.name !== 'Unknown') {
      const stillMatches = 
        (ariaLabelAfterScroll && ariaLabelAfterScroll.includes(contact.name)) ||
        (hrefAfterScroll && hrefAfterScroll.includes(contact.name.split(' ')[0]));
      if (!stillMatches) {
        throw new Error(`Link changed after scroll! Expected ${contact.name}, got aria-label: ${ariaLabelAfterScroll}`);
      }
    }
    
    // CRITICAL: Before clicking, verify no other message links are being hovered/clicked
    // This prevents accidentally clicking another contact's link
    console.log('   🔒 Verifying no other message links are active...');
    const allMessageLinks = page.locator('main a[href*="messaging/compose"]');
    const totalLinks = await allMessageLinks.count();
    console.log(`   📊 Total message links on page: ${totalLinks}`);
    
    // Verify our link is still the correct one
    const finalHref = await messageLink.getAttribute('href').catch(() => '');
    const finalAriaLabel = await messageLink.getAttribute('aria-label').catch(() => '');
    if (contact.name && contact.name !== 'Unknown') {
      const stillCorrect = 
        (finalAriaLabel && finalAriaLabel.includes(contact.name)) ||
        (finalHref && finalHref.includes(contact.name.split(' ')[0]));
      if (!stillCorrect) {
        throw new Error(`Link changed before clicking! Expected ${contact.name}, got: ${finalAriaLabel}`);
      }
    }
    
    // CRITICAL: Aggressive blur before clicking message link to prevent Finder popup
    console.log('   🔒 Blurring all elements before clicking message link...');
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => {
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        document.body.blur();
        const buttons = document.querySelectorAll('button');
        buttons.forEach((el: any) => {
          if (el && el.blur) el.blur();
        });
        const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
        inputs.forEach((el: any) => {
          if (el && el.blur) el.blur();
        });
        // Blur all focusable elements
        const focusable = document.querySelectorAll('a, button, input, textarea, select, [contenteditable], [tabindex]');
        focusable.forEach((el: any) => {
          if (el && el.blur) el.blur();
        });
      });
      await humanPause(30, 50);
    }
    await humanPause(300, 400);
    
    // CRITICAL: Use JavaScript click instead of Playwright click to avoid keyboard events
    // This prevents Finder popup from being triggered
    try {
      console.log(`   🎯 Clicking message link for ${contact.name} (href: ${finalHref.substring(0, 80)}...)...`);
      
      // Use JavaScript click with synthetic mouse event
      await messageLink.evaluate((el: any) => {
        // Blur everything first
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        document.body.blur();
        
        // Blur all other links
        const links = document.querySelectorAll('a');
        links.forEach((link: any) => {
          if (link !== el && link.blur) link.blur();
        });
        
        // Use synthetic mouse event instead of click()
        const mouseEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true,
          buttons: 1
        });
        el.dispatchEvent(mouseEvent);
      });
      
      console.log(`   ✅ Click succeeded for ${contact.name}`);
      
      // CRITICAL: Aggressive blur immediately after clicking message link
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => {
          if (document.activeElement && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          document.body.blur();
          const buttons = document.querySelectorAll('button');
          buttons.forEach((el: any) => {
            if (el && el.blur) el.blur();
          });
          const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
          inputs.forEach((el: any) => {
            if (el && el.blur) el.blur();
          });
          const links = document.querySelectorAll('a');
          links.forEach((el: any) => {
            if (el && el.blur) el.blur();
          });
        });
        await humanPause(30, 50);
      }
      
      // Immediately after clicking, verify we didn't accidentally click another link
      // by checking if any other message links are now focused/hovered
      await humanPause(500, 800);
      
    } catch (e) {
      console.error(`   ❌ Click failed: ${(e as Error).message}`);
      console.log(`   ⚠️  Playwright click failed: ${(e as Error).message}`);
      
      // Fallback: Try JavaScript click with proper event sequence
      try {
        console.log('   🎯 Trying JavaScript click with event sequence...');
        await messageLink.evaluate((el: HTMLElement) => {
          const anchor = el instanceof HTMLAnchorElement ? el : el.closest('a');
          if (anchor) {
            // Create proper mouse events with all required properties
            const rect = anchor.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            // Dispatch events in correct order with proper coordinates
            const mouseDown = new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              view: window,
              buttons: 1,
              clientX: centerX,
              clientY: centerY,
              button: 0
            });
            
            const mouseUp = new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              view: window,
              buttons: 0,
              clientX: centerX,
              clientY: centerY,
              button: 0
            });
            
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              buttons: 0,
              clientX: centerX,
              clientY: centerY,
              button: 0
            });
            
            anchor.dispatchEvent(mouseDown);
            anchor.dispatchEvent(mouseUp);
            anchor.dispatchEvent(clickEvent);
            
            // Also call native click as fallback
            anchor.click();
          }
        });
        console.log('   ✅ JavaScript click succeeded');
      } catch (e2) {
        console.log(`   ⚠️  JavaScript click failed: ${(e2 as Error).message}`);
        throw new Error(`Failed to click message link: ${(e2 as Error).message}`);
      }
    }
    
    // Wait for message dialog to open (LinkedIn needs time to process the click)
    console.log('   ⏳ Waiting for message dialog to open for ' + contact.name + '...');
    await humanPause(1800, 3200); // Slightly longer initial wait
    
    // Helper to find a dialog matching this contact
    const findDialogForContact = async (): Promise<Locator | null> => {
      let dialog: Locator | null = null;
      
      // Strategy 1: Look for dialog containing the contact name (multiple patterns)
      const contactNameInDialog = [
        `[role="dialog"]:has([aria-label*="Remove ${contact.name}" i])`,
        `[role="dialog"]:has-text("${contact.name}")`,
        `[role="dialog"]:has([aria-label*="${contact.name}" i])`,
        `[data-artdeco-modal][role="dialog"]:has-text("${contact.name}")`,
        `.msg-overlay-bubble:has-text("${contact.name}")`,
        `.msg-overlay-list-bubble:has-text("${contact.name}")`,
      ];
      
      if (contact.name && contact.name !== 'Unknown') {
        for (const selector of contactNameInDialog) {
          const candidate = page.locator(selector).first();
          const count = await candidate.count();
          if (count > 0) {
            const isVisible = await candidate.isVisible({ timeout: 3000 }).catch(() => false);
            if (isVisible) {
              const dialogText = await candidate.textContent().catch(() => '');
              if (!dialogText || dialogText.includes(contact.name)) {
                dialog = candidate;
                console.log(`   ✅ Found message dialog for ${contact.name} (selector: ${selector})`);
                break;
              }
            }
          }
        }
      }
      
      // Strategy 2: Dialog with "New message" heading and a textbox
      if (!dialog) {
        const newMessageDialog = page.locator('[role="dialog"]:has(h2:has-text("New message"))').first();
        if (await newMessageDialog.count()) {
          const isVisible = await newMessageDialog.isVisible({ timeout: 3000 }).catch(() => false);
          if (isVisible) {
            const hasTextbox = await newMessageDialog.locator('[contenteditable="true"][role="textbox"]').count().catch(() => 0);
            if (!contact.name || (await newMessageDialog.textContent().catch(() => '')).includes(contact.name) || hasTextbox) {
              dialog = newMessageDialog;
              console.log('   ✅ Found new message dialog (by heading)');
            }
          }
        }
      }
      
      // Strategy 3: Most recent visible dialog with textbox
      if (!dialog) {
        const allDialogs = page.locator('[role="dialog"], [data-artdeco-modal], .msg-overlay-bubble, .msg-overlay-list-bubble');
        const dialogCount = await allDialogs.count();
        for (let i = dialogCount - 1; i >= 0; i--) {
          const candidate = allDialogs.nth(i);
          const isVisible = await candidate.isVisible({ timeout: 2000 }).catch(() => false);
          if (isVisible) {
            const hasTextbox = await candidate.locator('[contenteditable="true"][role="textbox"]').count().catch(() => 0);
            const text = await candidate.textContent().catch(() => '');
            if (hasTextbox || !contact.name || text.includes(contact.name)) {
              dialog = candidate;
              console.log(`   ✅ Using dialog #${i + 1} (visible and has textbox${contact.name ? ' / name match' : ''})`);
              break;
            }
          }
        }
      }
      
      return dialog;
    };
    
    let messageDialog: Locator | null = await findDialogForContact();
    
    // If not found, retry: re-click the message link once and wait again
    if (!messageDialog) {
      console.log('   🔁 Dialog not found, re-clicking message link and waiting again...');
      try {
        await messageLink.click({ timeout: 5000 });
      } catch {
        // fallback: JS click if Playwright click fails
        await messageLink.evaluate((el: HTMLElement) => el.click());
      }
      await humanPause(2000, 3500);
      messageDialog = await findDialogForContact();
    }
    if (!messageDialog) {
      throw new Error(`Could not find message dialog for ${contact.name} after clicking message link`);
    }
    
    // FINAL VERIFICATION: Double-check the dialog contains the contact's name (warn only)
    if (contact.name && contact.name !== 'Unknown') {
      const finalDialogText = await messageDialog.textContent().catch(() => '');
      if (!finalDialogText.includes(contact.name)) {
        console.warn(`   ⚠️ Dialog does not contain contact name "${contact.name}" - proceeding anyway (UI may have changed)`);
      } else {
        console.log(`   ✅ Verified dialog is for ${contact.name}`);
      }
    }
    
    await messageDialog.waitFor({ state: 'visible', timeout: 15000 });
    await humanPause(1000, 2000);
    
    // Wait for message input field - try multiple selectors
    console.log('   🔍 Looking for message input field...');
    const messageInputSelectors = [
      'textbox[placeholder*="Write a message" i]',
      'textbox[placeholder*="message" i]',
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
        const isVisible = await input.isVisible({ timeout: 5000 }).catch(() => false);
        if (isVisible) {
        messageInput = input;
        console.log(`   ✅ Found message input with selector: ${selector}`);
        break;
        }
      }
    }
    
    if (!messageInput) {
      throw new Error('Message input field not found - tried multiple selectors');
    }
    
    await humanPause(500, 1000);
    
    // Extract LinkedIn's pre-filled template (we'll clear and rebuild with greeting)
    const originalTemplate = await messageInput.textContent().catch(() => '') || 
                           await messageInput.inputValue().catch(() => '') || 
                           await messageInput.evaluate((el: any) => el.innerText || el.textContent || el.value || '').catch(() => '');
    
    if (originalTemplate.trim()) {
      console.log(`   📝 Extracted LinkedIn template (${originalTemplate.trim().length} chars): "${originalTemplate.trim().substring(0, 50)}..."`);
    } else {
      console.warn(`   ⚠️  No pre-filled template found - will send only our links`);
    }
    
    // Extract first name from contact name for personalization
    const firstName = extractFirstName(contact.name);
    if (firstName) {
      console.log(`   👤 Extracted first name: "${firstName}" from "${contact.name}"`);
    } else {
      console.warn(`   ⚠️  Could not extract first name from "${contact.name}"`);
    }
    
    // Get the text for our custom links
    const profileText = (settings.message_template_profile || '').replace('{profile_url}', settings.profile_url || '');
    const companyText = (settings.message_template_company || '').replace('{company_url}', settings.company_url || '');
    
    // Enhance message with greeting + template + links (full message to type)
    const enhancedMessage = enhanceMessage(
      originalTemplate,
      settings.profile_url || '',
      settings.company_url,
      settings.message_template_profile,
      settings.message_template_company,
      firstName
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
      if (existing[0].status === 'failed' && messageId) {
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
    
    // Type enhanced message - clear existing content and type full message
    console.log('   📝 Filling message input with full enhanced message...');
    
    const tagName = await messageInput.evaluate((el: any) => el.tagName?.toLowerCase()).catch(() => '');
    const role = await messageInput.getAttribute('role').catch(() => '');
    const isContentEditable = await messageInput.evaluate((el: any) => el.contentEditable === 'true').catch(() => false);
    
    if (isContentEditable || (tagName === 'div' && role === 'textbox')) {
      console.log('   ⌨️  Typing full message in contenteditable div...');
      
      // CRITICAL: Prevent page scrolling or clicking other elements while typing
      // Lock the page to prevent any interactions that might switch contacts
      console.log('   🔒 Locking page interactions to prevent contact switching...');
      
      // Ensure input is in view - but DON'T scroll the main page, only scroll within dialog if needed
      try {
        // Get the dialog element to ensure it's stable
        const dialogVisible = await messageDialog.isVisible({ timeout: 2000 }).catch(() => false);
        if (!dialogVisible) {
          throw new Error('Message dialog disappeared - cannot continue typing');
        }
        
        // Scroll the input into view within the dialog (not the main page)
        await messageInput.scrollIntoViewIfNeeded({ timeout: 3000 });
        await humanPause(200, 300);
      } catch (e) {
        console.log('   ⚠️  Scrolling failed, but continuing...');
      }
      
      // Clear the input field completely before typing full message
      console.log('   🧹 Clearing existing content to rebuild full message with greeting...');
      
      // Clear the input field
      await messageInput.clear();
      await humanPause(200, 300);
      
      // Verify it's cleared
      const textAfterClear = await messageInput.evaluate((el: any) => {
        return (el.textContent || el.innerText || el.value || '').trim();
      }).catch(() => '');
      
      if (textAfterClear.length > 0) {
        console.log(`   ⚠️  Input not fully cleared (${textAfterClear.length} chars remaining), forcing clear...`);
        // Force clear by setting content directly
        await messageInput.evaluate((el: any) => {
          if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            el.value = '';
          } else {
            el.textContent = '';
            el.innerText = '';
            el.innerHTML = '';
          }
        });
        await humanPause(200, 300);
      }
      
      console.log('   ✅ Input field cleared, ready to type full message');
      
      // Focus the element and type the full enhanced message
      await messageInput.focus();
      await humanPause(200, 300);
      
      // Type the complete enhanced message (greeting + template + links)
      console.log(`   ⌨️  Typing full enhanced message (${enhancedMessage.length} chars)...`);
      await messageInput.fill(enhancedMessage);
      
      // Trigger input events to ensure LinkedIn recognizes the change
      
      // Trigger input event
      await messageInput.evaluate((el: any) => {
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      });
      
      await humanPause(500, 800);
      console.log('   ✅ Appended our links below LinkedIn template');
      
      await humanPause(300, 500);
      
      // Verify the message was typed
      const typedContent = (await messageInput.textContent().catch(() => '')) || 
                          (await messageInput.evaluate((el: any) => el.innerText || el.textContent || '').catch(() => ''));
      
      if (typedContent.length < enhancedMessage.length * 0.8) {
        console.log(`   ⚠️  Message not fully typed (got ${typedContent.length} chars, expected ~${enhancedMessage.length}), setting directly...`);
        // Fallback: set content directly with proper formatting
      await messageInput.evaluate((el: any, text: string) => {
        el.focus();
          if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            el.value = text;
          } else {
            // Convert newlines to <br> tags for contenteditable divs
            let formattedHTML = text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/\n\n+/g, '<br><br>') // Multiple newlines = paragraph break
              .replace(/\n/g, '<br>'); // Single newline = line break
            el.innerHTML = formattedHTML;
            el.textContent = text;
          }
          // Move cursor to end
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel?.removeAllRanges();
          sel?.addRange(range);
      }, enhancedMessage);
        await humanPause(500, 800);
      } else {
        console.log(`   ✅ Message typed successfully (${typedContent.length} characters)`);
      }
      
      // Trigger input events to ensure LinkedIn recognizes the change
      await messageInput.evaluate((el: any) => {
        el.focus();
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      });
      await humanPause(300, 500);
    } else if (tagName === 'textarea') {
      // Clear and type full message for textarea
      console.log(`   📝 Clearing and typing full message in ${tagName}...`);
      
      // Clear the textarea
      await messageInput.clear();
      await humanPause(200, 300);
      
      // Focus and type the full enhanced message
      await messageInput.focus();
      await humanPause(200, 300);
      
      console.log(`   ⌨️  Typing full enhanced message (${enhancedMessage.length} chars) in textarea...`);
      await messageInput.fill(enhancedMessage);
      
      // Trigger input events
      await messageInput.evaluate((el: any) => {
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      });
      await humanPause(500, 800);
      console.log(`   ✅ Message set in textarea (${enhancedMessage.length} characters)`);
    }
    
    await humanPause(800, 1200); // Wait for Send to enable after typing
    
    // Verify message was set - try multiple ways to read content
    const messageText = (await messageInput.evaluate((el: any) => {
      // Try different properties to get the text
      return el.innerText || el.textContent || el.value || '';
    }).catch(() => '')) || 
    (await messageInput.textContent().catch(() => '')) || 
    (await messageInput.inputValue().catch(() => '')) || '';
    
    const trimmedText = messageText.trim();
    const expectedMinLength = enhancedMessage.length * 0.7; // Allow some tolerance
    
    if (!trimmedText || trimmedText.length < expectedMinLength) {
      console.warn(`   ⚠️  Message text may not have been set correctly (got ${trimmedText.length} chars, expected ~${enhancedMessage.length})`);
      console.log(`   🔄 Retrying with direct innerText method...`);
      
      // Final fallback: clear and set full message directly
      console.log('   🔄 Retrying by clearing and setting full message directly...');
      await messageInput.clear();
      await humanPause(200, 300);
      
      // Set the full enhanced message using evaluate (more reliable for contenteditable)
      await messageInput.evaluate((el: any, text: string) => {
        el.focus();
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          el.value = text;
        } else {
          // Convert newlines to <br> tags for contenteditable divs
          let formattedHTML = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n\n+/g, '<br><br>') // Multiple newlines = paragraph break
            .replace(/\n/g, '<br>'); // Single newline = line break
          el.innerHTML = formattedHTML;
          el.textContent = text;
        }
        // Move cursor to end
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        // Trigger events
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      }, enhancedMessage);
      
      await humanPause(1000, 1500);
      
      // Verify again
      const retryText = (await messageInput.evaluate((el: any) => {
        return el.innerText || el.textContent || el.value || '';
      }).catch(() => '')) || '';
      
      if (retryText.trim().length < expectedMinLength) {
        throw new Error(`Failed to set message text: got ${retryText.trim().length} chars, expected at least ${expectedMinLength}`);
      } else {
        console.log(`   ✅ Message text set after retry (${retryText.trim().length} characters)`);
      }
    } else {
      console.log(`   ✅ Message text verified (${trimmedText.length} characters)`);
    }
    
    // Wait a bit more and check if Send button is enabled
    await humanPause(1000, 1500);
    
    // Check if Send button is enabled before trying to click
    // IMPORTANT: Search within the messageDialog, not the page, to avoid finding buttons in other dialogs
    // CRITICAL: Based on browser investigation, send button has className "msg-form__send-button" and NO aria-label
    // Attach buttons have className "msg-form__footer-action" and aria-label containing "Attach"
    console.log('   🔍 Looking for Send button in message dialog (excluding attachment buttons)...');
    const sendButtonSelectors = [
      // PRIMARY: Use className selector - most reliable (send button has "msg-form__send-button" class)
      'button.msg-form__send-button:not([disabled])',
      // Alternative: check for send-button in class
      'button[class*="send-button"]:not([disabled]):not([class*="footer-action"])',
      // LinkedIn data-control-name (legacy compose send)
      'button[data-control-name="compose_send"]:not([disabled])',
      // LinkedIn data-testid variants
      'button[data-testid*="send"]:not([disabled]):not([class*="footer-action"])',
      // Global send button test id
      'button[data-test-global-send-button]:not([disabled])',
      // Generic submit buttons (fallback)
      'button[type="submit"]:not([disabled])',
      // Fallback: text content "Send" but exclude footer-action buttons (attach buttons)
      'button:has-text("Send"):not([disabled]):not([class*="footer-action"])',
      // Footer send buttons
      'footer button:has-text("Send"):not([disabled])',
      // Last resort: any button with "Send" in aria-label (but send button might not have one)
      'button[aria-label*="Send" i]:not([disabled]):not([class*="footer-action"])',
    ];
    
    let sendButton: Locator | null = null;
    
    // If we see the "send options" toggle, click it to reveal the real send button
    const sendToggle = messageDialog.locator('button.msg-form__send-toggle').first();
    const toggleCount = await sendToggle.count().catch(() => 0);
    if (toggleCount > 0) {
      const toggleVisible = await sendToggle.isVisible({ timeout: 2000 }).catch(() => false);
      if (toggleVisible) {
        console.log('   🟢 Found send options toggle, clicking to reveal send button...');
        await sendToggle.click({ timeout: 2000 }).catch(() => {});
        await humanPause(500, 800);
      }
    }
    for (const selector of sendButtonSelectors) {
      try {
        // Search within the messageDialog (the new message dialog we found)
      const btn = messageDialog.locator(selector).first();
      const count = await btn.count();
      if (count > 0) {
          const isVisible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
          if (isVisible) {
            // CRITICAL: Verify it's actually the send button and NOT an attachment button
            const btnText = await btn.textContent().catch(() => '');
            const btnAriaLabel = await btn.getAttribute('aria-label').catch(() => '');
            const btnClass = await btn.getAttribute('class').catch(() => '');
            
            const lowerText = (btnText || '').trim().toLowerCase();
            const lowerAria = (btnAriaLabel || '').toLowerCase();
            const lowerClass = (btnClass || '').toLowerCase();
            
            // CRITICAL: Check if it's an attachment button (EXCLUDE these)
            // Attach buttons have "msg-form__footer-action" class or aria-label with "attach"
            const isAttachmentButton = 
              lowerClass.includes('footer-action') || // Attach buttons have this class
              lowerAria.includes('attach') || 
              lowerAria.includes('image') || 
              lowerAria.includes('file') || 
              lowerAria.includes('upload');
            
            // CRITICAL: Check if it's a send button (INCLUDE these)
            // Send button has "msg-form__send-button" class or text "Send"
            const isSendButton = 
              lowerClass.includes('msg-form__send-button') || // Primary identifier
              lowerClass.includes('send-button') ||
              (lowerText === 'send' && !isAttachmentButton); // Text is "Send" and not an attach button
            
            if (isSendButton && !isAttachmentButton) {
        sendButton = btn;
        console.log(`   ✅ Found Send button with selector: ${selector}`);
        console.log(`      - className: "${btnClass}"`);
        console.log(`      - textContent: "${btnText}"`);
        console.log(`      - aria-label: "${btnAriaLabel || '(none)'}"`);
        break;
            } else if (isAttachmentButton) {
              console.log(`   ⚠️  Skipping attachment button (class: "${btnClass}", aria-label: "${btnAriaLabel}")`);
            } else {
              console.log(`   ⚠️  Skipping non-send button (class: "${btnClass}", text: "${btnText}", aria-label: "${btnAriaLabel}")`);
            }
          }
        }
      } catch (e) {
        // Continue to next selector
        continue;
      }
    }
    
    if (!sendButton) {
      console.warn('   ⚠️ Send button not found after all selectors. Falling back to Enter key on message input...');
      try {
        await messageInput.focus();
        await humanPause(200, 400);
        await messageInput.press('Enter');
        await humanPause(1200, 1800);
        console.log('   ✅ Enter key fallback attempted');
      } catch (enterErr) {
        console.warn(`   ⚠️ Enter key fallback failed: ${(enterErr as Error).message}`);
        throw new Error('Send button not found and Enter fallback failed');
      }
      // Treat as failure (unknown send state) to avoid undefined processResult upstream
      return { success: false, error: 'Send button not found; Enter fallback attempted' };
    }
    
    // Wait for Send button to be enabled (LinkedIn enables it after detecting text input)
    console.log('   ⏳ Waiting for Send button to be enabled...');
    let isEnabled = false;
    const maxAttempts = 18; // Slightly more retries
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const isDisabled = await sendButton.evaluate((el: any) => {
        return el.disabled || 
               el.getAttribute('aria-disabled') === 'true' ||
               el.classList.contains('artdeco-button--disabled') ||
               el.hasAttribute('disabled');
      }).catch(() => true);
      
      if (!isDisabled) {
        isEnabled = true;
        console.log(`   ✅ Send button is enabled (attempt ${attempt + 1})`);
        break;
      }
      
      if (attempt < maxAttempts - 1) {
        if (attempt % 3 === 0) {
          console.log(`   ⏳ Send button still disabled, waiting... (attempt ${attempt + 1}/${maxAttempts})`);
        }
        
        await humanPause(1500, 2000);
        
        // Try triggering input events periodically to wake up LinkedIn
        if (attempt % 3 === 0) {
          // Verify text is still there
          const currentText = await messageInput.evaluate((el: any) => el.innerText || el.textContent || el.value || '').catch(() => '');
          if (currentText.length < enhancedMessage.length * 0.8) {
            console.log(`   ⚠️  Text seems incomplete, clearing and setting full message again...`);
            // Clear and set the full message
            await messageInput.clear();
            await humanPause(200, 300);
            await messageInput.fill(enhancedMessage);
            await messageInput.evaluate((el: any) => {
              el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
              el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            });
            await humanPause(1000, 1500);
          } else {
            // Text is there, just trigger events (NO SPACE KEY - it triggers Finder)
            await messageInput.evaluate((el: any) => {
              el.focus();
              // Trigger input events to simulate user activity (NO keyboard events with Space)
              el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
              el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
              el.dispatchEvent(new Event('focus', { bubbles: true, cancelable: true }));
            });
            await humanPause(500, 800);
          }
          
          // Nudge: type a space then backspace to trigger enablement (safe via type/press)
          try {
            await messageInput.type(' ', { delay: 25 });
            await messageInput.press('Backspace');
          } catch {
            // ignore typing errors
          }
        }
      }
    }
    
    if (!isEnabled) {
      // Last attempt: trigger input events to wake up LinkedIn
      // NEVER use keyboard.press() here - it can trigger system shortcuts (Finder/Spotlight)
      // DON'T click - clicking might place cursor in the middle
      // Always use JavaScript events instead
      console.log(`   🔄 Last attempt: triggering input events via JavaScript (no keyboard shortcuts, no clicking)...`);
      await messageInput.evaluate((el: any) => {
        el.focus();
        // Ensure cursor is at end
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          const length = el.value.length;
          el.setSelectionRange(length, length);
        } else {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      });
      await humanPause(200, 400);
      
      // Use JavaScript events instead of keyboard to prevent Finder/Spotlight from opening
      // NO SPACE KEY EVENTS - they trigger Finder on macOS
      await messageInput.evaluate((el: any) => {
        el.focus();
        // Trigger multiple events to simulate user input (NO keyboard events with Space)
        el.dispatchEvent(new Event('focus', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      });
      await humanPause(1000, 1500);
      
      const stillDisabled = await sendButton.evaluate((el: any) => {
        return el.disabled || 
               el.getAttribute('aria-disabled') === 'true' ||
               el.classList.contains('artdeco-button--disabled');
      }).catch(() => true);
      
      if (stillDisabled) {
        throw new Error('Send button is still disabled after all attempts - message input may not be recognized by LinkedIn');
      } else {
        console.log(`   ✅ Send button enabled after space trigger!`);
        isEnabled = true;
      }
    }
    
    await sendButton.scrollIntoViewIfNeeded();
    await humanPause(300, 600);
    console.log('   📤 Clicking Send button...');
    
    // Check if button is disabled (might be if message is empty)
    const isDisabled = await sendButton.isDisabled().catch(() => false);
    if (isDisabled) {
      console.warn('   ⚠️  Send button is disabled, clearing and setting full message again...');
      // Clear and set the full message
      await messageInput.clear();
      await humanPause(200, 300);
      await messageInput.fill(enhancedMessage);
      await messageInput.evaluate((el: any) => {
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      });
      await humanPause(500, 1000);
    }
    
    console.log(`   🖱️  Clicking Send button for ${contact.name}...`);
    
    // CRITICAL: Blur elements BEFORE clicking send to prevent Finder popup
    // BUT: DO NOT blur the send button itself - we need to click it!
    // Based on browser investigation: send button has class "msg-form__send-button"
    // Attach buttons have class "msg-form__footer-action"
    console.log('   🔒 Blurring other elements (but NOT the send button with class "msg-form__send-button")...');
    
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        // Blur active element (but not if it's the send button)
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
          const activeClass = document.activeElement.className || '';
          // Don't blur if it's the send button (has msg-form__send-button class)
          if (!activeClass.includes('msg-form__send-button')) {
            document.activeElement.blur();
          }
        }
        // Blur all input elements (message input, etc.)
        const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
        inputs.forEach((el: any) => {
          if (el && el.blur) el.blur();
        });
        // Blur all buttons EXCEPT the send button (identified by class)
        const buttons = document.querySelectorAll('button');
        buttons.forEach((el: any) => {
          const btnClass = el.className || '';
          // Only blur if it's NOT the send button (doesn't have msg-form__send-button class)
          // Also blur attach buttons (msg-form__footer-action) to prevent accidental clicks
          if (el && el.blur && !btnClass.includes('msg-form__send-button')) {
            el.blur();
          }
        });
        // Blur body
        if (document.body) {
          document.body.blur();
        }
      });
      await humanPause(50, 100);
    }
    
    // Verify we're clicking the send button, not an attachment button
    const finalCheck = await sendButton.evaluate((el: any) => {
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const className = el.getAttribute('class') || '';
      const lowerAria = ariaLabel.toLowerCase();
      const lowerTitle = title.toLowerCase();
      const lowerClass = className.toLowerCase();
      
      const isAttachment = 
        lowerAria.includes('attach') || lowerAria.includes('image') || lowerAria.includes('file') || lowerAria.includes('upload') ||
        lowerTitle.includes('attach') || lowerTitle.includes('image') || lowerTitle.includes('file') || lowerTitle.includes('upload') ||
        lowerClass.includes('attach') || lowerClass.includes('image') || lowerClass.includes('file') || lowerClass.includes('upload');
      
      return !isAttachment;
    }).catch(() => true);
    
    if (!finalCheck) {
      throw new Error('Send button verification failed - appears to be an attachment button');
    }
    
    // Scroll send button into view
    await sendButton.scrollIntoViewIfNeeded();
    await humanPause(200, 300);
    
    // CRITICAL: Final verification - double check it's the send button and not attachment
    const finalVerification = await sendButton.evaluate((el: any) => {
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const className = el.getAttribute('class') || '';
      const text = el.textContent || '';
      
      const lowerAria = ariaLabel.toLowerCase();
      const lowerTitle = title.toLowerCase();
      const lowerClass = className.toLowerCase();
      const lowerText = text.toLowerCase();
      
      // Check if it's an attachment button (exclude these)
      const isAttachment = 
        lowerAria.includes('attach') || lowerAria.includes('image') || lowerAria.includes('file') || lowerAria.includes('upload') ||
        lowerTitle.includes('attach') || lowerTitle.includes('image') || lowerTitle.includes('file') || lowerTitle.includes('upload') ||
        lowerClass.includes('attach') || lowerClass.includes('image') || lowerClass.includes('file') || lowerClass.includes('upload') ||
        lowerText.includes('attach') || lowerText.includes('image') || lowerText.includes('file') || lowerText.includes('upload');
      
      // Check if it's a send button (include these)
      const isSend = 
        lowerAria.includes('send') || lowerTitle.includes('send') || lowerText.includes('send') ||
        lowerClass.includes('send-button') || lowerClass.includes('msg-form__send-button');
      
      return {
        isSend: isSend && !isAttachment,
        ariaLabel,
        className,
        isAttachment
      };
    }).catch(() => ({ isSend: false, ariaLabel: '', className: '', isAttachment: false }));
    
    if (!finalVerification.isSend || finalVerification.isAttachment) {
      throw new Error(`Send button verification failed - found button with aria-label: "${finalVerification.ariaLabel}", class: "${finalVerification.className}" (isAttachment: ${finalVerification.isAttachment})`);
    }
    
    console.log(`   ✅ Verified Send button (aria-label: "${finalVerification.ariaLabel}", class: "${finalVerification.className}")`);
    
    // CRITICAL: Use synthetic MouseEvent instead of click() to avoid keyboard events
    // This prevents Finder popup from being triggered
    // DO NOT blur the send button itself - we need to click it!
    // Based on browser investigation: send button has class "msg-form__send-button"
    await sendButton.evaluate((el: any) => {
      // Blur everything EXCEPT the send button (identified by class)
      if (document.activeElement && document.activeElement instanceof HTMLElement) {
        const activeClass = document.activeElement.className || '';
        // Don't blur if it's the send button
        if (!activeClass.includes('msg-form__send-button')) {
          document.activeElement.blur();
        }
      }
      document.body.blur();
      
      // Blur all other buttons (but NOT the send button - identified by class)
      const buttons = document.querySelectorAll('button');
      buttons.forEach((btn: any) => {
        const btnClass = btn.className || '';
        // Only blur if it's NOT the send button (doesn't have msg-form__send-button class)
        if (btn && btn.blur && !btnClass.includes('msg-form__send-button')) {
          btn.blur();
        }
      });
      
      // Blur all input elements
      const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
      inputs.forEach((input: any) => {
        if (input && input.blur) input.blur();
      });
      
      // Use synthetic MouseEvent instead of click() - this doesn't trigger keyboard events
      const mouseEvent = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true,
        buttons: 1
      });
      el.dispatchEvent(mouseEvent);
    });
    
    // CRITICAL: Immediately blur again multiple times after clicking to prevent any keyboard events
    for (let i = 0; i < 7; i++) {
      await page.evaluate(() => {
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        // Blur all input elements
        const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
        inputs.forEach((el: any) => {
          if (el && el.blur) el.blur();
        });
        // Blur all buttons
        const buttons = document.querySelectorAll('button');
        buttons.forEach((el: any) => {
          if (el && el.blur) el.blur();
        });
        // Blur body
        if (document.body) {
          document.body.blur();
        }
        // Blur any dialogs
        const dialogs = document.querySelectorAll('[role="dialog"]');
        dialogs.forEach((dialog: any) => {
          if (dialog && dialog.blur) dialog.blur();
        });
      });
      await humanPause(100, 150);
    }
    
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
    // Try to actively close the dialog if it doesn't close automatically
    console.log(`   ⏳ Waiting for message to send and dialog to close...`);
    
    // CRITICAL: Blur ALL elements IMMEDIATELY after sending to prevent Finder popup
    // Do this multiple times throughout the dialog closing process
    for (let i = 0; i < 7; i++) {
      await page.evaluate(() => {
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        // Blur all input elements
        const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"], button, a');
        inputs.forEach((el: any) => {
          if (el && el.blur) el.blur();
        });
        // Blur body
        if (document.body) {
          document.body.blur();
        }
        // Blur any focused elements in dialogs
        const dialogs = document.querySelectorAll('[role="dialog"]');
        dialogs.forEach((dialog: any) => {
          if (dialog && dialog.blur) dialog.blur();
          const focused = dialog.querySelector(':focus');
          if (focused && focused.blur) focused.blur();
        });
      });
      await humanPause(50, 100);
    }
    
    await humanPause(2000, 3000); // Wait for message to send
    
    // Check if dialog is still open
    let dialogStillOpen = await messageDialog.isVisible().catch(() => false);
    
    if (dialogStillOpen) {
      console.log(`   ⚠️  Dialog still open for ${contact.name}, attempting to close it...`);
      
      // Try to find and click the close button (but NOT using keyboard shortcuts that trigger Finder)
      const closeButtonSelectors = [
        'button[aria-label*="Close" i]',
        'button[aria-label*="Dismiss" i]',
        'button[aria-label*="Minimize" i]',
        'button[title*="Close" i]',
        'button[title*="Dismiss" i]',
        'button[class*="close"]',
        'button[class*="dismiss"]',
        'button[data-testid*="close"]'
      ];
      
      let dialogClosed = false;
      for (const selector of closeButtonSelectors) {
        try {
          const closeBtn = messageDialog.locator(selector).first();
          const count = await closeBtn.count();
          if (count > 0) {
            const isVisible = await closeBtn.isVisible({ timeout: 2000 }).catch(() => false);
            if (isVisible) {
              // CRITICAL: Blur before clicking close button, but NOT the close button itself
              // Get the close button's aria-label to identify it
              const closeBtnAriaLabel = await closeBtn.getAttribute('aria-label').catch(() => '');
              
              for (let blurI = 0; blurI < 3; blurI++) {
                await page.evaluate((excludeAriaLabel: string) => {
                  // Blur active element (but not if it's the close button)
                  if (document.activeElement && document.activeElement instanceof HTMLElement) {
                    const activeAria = document.activeElement.getAttribute('aria-label') || '';
                    // Don't blur if it's the close button
                    if (activeAria !== excludeAriaLabel) {
                      document.activeElement.blur();
                    }
                  }
                  document.body.blur();
                  
                  // Blur all buttons EXCEPT the close button
                  const buttons = document.querySelectorAll('button');
                  buttons.forEach((el: any) => {
                    const btnAria = el.getAttribute('aria-label') || '';
                    // Only blur if it's NOT the close button
                    if (el && el.blur && btnAria !== excludeAriaLabel) {
                      el.blur();
                    }
                  });
                  
                  // Blur all input elements
                  const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
                  inputs.forEach((el: any) => {
                    if (el && el.blur) el.blur();
                  });
                }, closeBtnAriaLabel);
                await humanPause(50, 100);
              }
              await humanPause(200, 300);
              
              // CRITICAL: Use synthetic MouseEvent instead of click() to avoid keyboard events
              await closeBtn.evaluate((el: any) => {
                // Blur everything EXCEPT this close button
                if (document.activeElement && document.activeElement instanceof HTMLElement) {
                  if (document.activeElement !== el) {
                    document.activeElement.blur();
                  }
                }
                document.body.blur();
                
                // Blur all other buttons (but NOT this close button)
                const buttons = document.querySelectorAll('button');
                buttons.forEach((btn: any) => {
                  if (btn && btn !== el && btn.blur) btn.blur();
                });
                
                // Blur all input elements
                const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
                inputs.forEach((input: any) => {
                  if (input && input.blur) input.blur();
                });
                
                // Use synthetic MouseEvent instead of click() - this doesn't trigger keyboard events
                const mouseEvent = new MouseEvent('click', {
                  view: window,
                  bubbles: true,
                  cancelable: true,
                  buttons: 1
                });
                el.dispatchEvent(mouseEvent);
              });
              await humanPause(500, 800);
              
              // Blur after clicking
              for (let j = 0; j < 5; j++) {
                await page.evaluate(() => {
                  if (document.activeElement && document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                  }
                  document.body.blur();
                  const buttons = document.querySelectorAll('button');
                  buttons.forEach((el: any) => {
                    if (el && el.blur) el.blur();
                  });
                  const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
                  inputs.forEach((el: any) => {
                    if (el && el.blur) el.blur();
                  });
                });
                await humanPause(50, 100);
              }
              
              // Check if dialog closed
              dialogStillOpen = await messageDialog.isVisible().catch(() => false);
              if (!dialogStillOpen) {
                dialogClosed = true;
                console.log(`   ✅ Dialog closed using ${selector}`);
                break;
              }
            }
      }
    } catch (e) {
          // Continue to next selector
          continue;
        }
      }
      
      if (!dialogClosed) {
        console.log(`   ⚠️  Could not close dialog for ${contact.name}, but continuing - will close when processing next contact`);
      }
    } else {
      console.log(`   ✅ Dialog closed automatically for ${contact.name}`);
    }
    
    // CRITICAL: Blur multiple times AFTER dialog closes to prevent Finder popup
    for (let i = 0; i < 7; i++) {
      await page.evaluate(() => {
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        // Blur all input elements
        const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"], button, a');
        inputs.forEach((el: any) => {
          if (el && el.blur) el.blur();
        });
        // Blur body
        if (document.body) {
          document.body.blur();
        }
        // Blur any remaining dialogs
        const dialogs = document.querySelectorAll('[role="dialog"]');
        dialogs.forEach((dialog: any) => {
          if (dialog && dialog.blur) dialog.blur();
        });
      });
      await humanPause(50, 100);
    }
    
    await humanPause(500, 800); // Final wait after closing
    
    // Only mark as sent if we got confirmation OR dialog closed
    if (!messageId) {
      throw new Error('Message ID not available');
    }
    
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
  
  // Get dynamic user agent (removes "Headless" to avoid detection)
  // Use a simpler approach that doesn't launch a separate browser
  const getUserAgent = async () => {
    try {
      // Use a realistic Chrome user agent without "Headless"
      // This avoids launching a separate browser instance
      const chromeVersion = '131.0.0.0'; // Update periodically
      const osInfo = process.platform === 'darwin' 
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';
      
      return `Mozilla/5.0 (${osInfo}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    } catch (e) {
      console.warn('   ⚠️  Could not generate user agent, using default');
      return undefined;
    }
  };

  // Launch browser similar to PG scraper (non-persistent, stealth plugins)
  const dynamicUserAgent = await getUserAgent();
  console.log(`   🔒 Using enhanced stealth mode${dynamicUserAgent ? ' with dynamic user agent' : ''}`);
  
  const browserArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions-except',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-ipc-flooding-protection',
    '--memory-pressure-off',
    '--max_old_space_size=4096'
  ];

  console.log('   🚀 Launching browser...');
  console.log(`   📋 Browser args: ${browserArgs.join(' ')}`);
  console.log(`   👁️  Headless mode: ${headlessMode}`);
  
  let browser;
  try {
    browser = await chromium.launch({
      headless: headlessMode,
      plugins: plugins.recommended({
        humanize: {
          click: { delay: { min: 200, max: 600 } },
          cursor: false,
          dialog: { delay: { min: 800, max: 2000 } }
        }
      }),
      args: browserArgs
    });
    console.log('   ✅ Browser launched successfully');
    console.log(`   🔗 Browser version: ${browser.version()}`);
  } catch (error: any) {
    console.error('   ❌ Failed to launch browser:', error.message);
    console.error('   📊 Error details:', {
      name: error.name,
      stack: error.stack,
      cause: error.cause
    });
    throw error;
  }
  
  const storagePath = getStorageStatePath();
  let hasSavedSession = hasStorageState();
  
  // Try to use saved session first - only clear if explicitly needed
  const shouldClearSession = process.env.CLEAR_LINKEDIN_SESSION === 'true';
  if (shouldClearSession && hasSavedSession) {
    console.log('   🧹 Clearing saved session (CLEAR_LINKEDIN_SESSION=true)...');
    deleteStorageState();
    hasSavedSession = false;
  } else if (hasSavedSession) {
    console.log('   💾 Found saved session, will try to use it first');
  } else {
    console.log('   📝 No saved session found, will login fresh');
  }

  console.log('   🌐 Creating browser context...');
  console.log(`   💾 Using saved session: ${hasSavedSession}`);
  if (hasSavedSession) {
    console.log(`   📁 Storage path: ${storagePath}`);
  }
  
  let context;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
      locale: 'en-US',
      timezoneId: settings.timezone || 'Asia/Singapore',
      ...(hasSavedSession ? { storageState: storagePath } : {})
    });
    console.log('   ✅ Browser context created successfully');
    console.log(`   📊 Context pages count: ${context.pages().length}`);
  } catch (error: any) {
    console.error('   ❌ Failed to create browser context:', error.message);
    console.error('   📊 Error details:', {
      name: error.name,
      stack: error.stack,
      browserConnected: !browser.isConnected() ? 'disconnected' : 'connected'
    });
    throw error;
  }
  
  // Restore sessionStorage if it was saved
  if (hasSavedSession) {
    try {
      const fs = await import('fs');
      const storageDir = path.dirname(storagePath);
      const sessionStoragePath = path.join(storageDir, 'linkedin.sessionStorage.json');
      
      if (fs.existsSync(sessionStoragePath)) {
        const sessionStorage = JSON.parse(fs.readFileSync(sessionStoragePath, 'utf-8'));
        
        await context.addInitScript((storage) => {
          if (window.location.hostname === 'www.linkedin.com' || window.location.hostname === 'linkedin.com') {
            for (const [key, value] of Object.entries(storage)) {
              try {
                window.sessionStorage.setItem(key, value as string);
              } catch (e) {
                // Ignore quota errors
              }
            }
          }
        }, sessionStorage);
        
        console.log('   💾 Restored sessionStorage from saved session');
      }
    } catch (e: any) {
      console.warn('   ⚠️  Could not restore sessionStorage:', e.message);
    }
  }
  
  // Enhanced stealth scripts to make browser appear more like real Chrome
  await context.addInitScript(() => {
    // Remove webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Override permissions API
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission } as PermissionStatus) :
        originalQuery(parameters)
    );
    
    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
    
    // Override chrome object
    (window as any).chrome = {
      runtime: {},
    };
  });
  
  console.log('   📄 Creating new page...');
  let page;
  try {
    page = await context.newPage();
    console.log('   ✅ Page created successfully');
    console.log(`   📊 Total pages in context: ${context.pages().length}`);
    console.log(`   🔗 Page URL: ${page.url()}`);
    console.log(`   📋 Page is closed: ${page.isClosed()}`);
  } catch (error: any) {
    console.error('   ❌ Failed to create page:', error.message);
    console.error('   📊 Error details:', {
      name: error.name,
      stack: error.stack,
      contextPages: context.pages().length,
      browserConnected: !browser.isConnected() ? 'disconnected' : 'connected'
    });
    throw error;
  }
  
  const result: ProcessResult = {
    success: false,
    contactsFound: 0,
    messagesSent: 0,
    messagesFailed: 0,
    messagesSkipped: 0,
    errors: []
  };
  
  try {
    // Login if needed (check hasSavedSession variable, not hasStorageState() again)
    if (!hasSavedSession) {
      await executeLoginFlow(page, context, email, password);
    } else {
      console.log('🔍 Verifying session...');
      console.log('   🔍 Checking browser state before feed navigation...');
      console.log(`   📋 Page is closed: ${page.isClosed()}`);
      console.log(`   📊 Context pages: ${context.pages().length}`);
      console.log(`   🔗 Browser connected: ${!browser.isConnected() ? 'disconnected' : 'connected'}`);
      
      try {
        await page.goto('https://www.linkedin.com/feed', { waitUntil: 'domcontentloaded', timeout: 5000 });
        console.log('   ✅ Feed navigation completed');
        await humanPause(2000, 2000); // 2 second wait before navigating to catch-up page
      } catch (timeoutError: any) {
        console.log('   ⚠️  Feed page load slow, trying catch-up page directly...');
        console.log(`   📊 Timeout error: ${timeoutError.message}`);
        try {
          // CRITICAL: Check if browser/context/page is still open before navigation
          console.log('   🔍 Checking browser/context/page state before catch-up navigation...');
          console.log(`   📋 Page is closed: ${page.isClosed()}`);
          
          if (page.isClosed()) {
            console.error('   ❌ Page is closed before navigation to catch-up page');
            throw new Error('Page is closed before navigation to catch-up page');
          }
          
          const pages = context.pages();
          console.log(`   📊 Context pages count: ${pages.length}`);
          console.log(`   📋 Page in context: ${pages.includes(page)}`);
          
          if (pages.length === 0 || !pages.includes(page)) {
            console.error('   ❌ Context is closed or page is detached');
            throw new Error('Context is closed or page is detached');
          }
          
          console.log('   ✅ Browser/context/page state verified, navigating to catch-up...');
          await page.goto('https://www.linkedin.com/mynetwork/catch-up/all/', { waitUntil: 'domcontentloaded', timeout: 60000 });
          console.log('   ✅ Navigation to catch-up completed');
          await humanPause(2000, 3000);
          console.log('   ✅ Session appears valid (catch-up page loaded)');
        } catch (e: any) {
          console.error('   ❌ Error during catch-up navigation:', e.message);
          console.error('   📊 Error details:', {
            name: e.name,
            message: e.message,
            stack: e.stack?.split('\n').slice(0, 5).join('\n')
          });
          
          if (e.message.includes('closed') || e.message.includes('detached')) {
            console.error('   ❌ Browser/context/page closed during navigation:', e.message);
            throw new Error(`Browser closed during navigation: ${e.message}`);
          }
          console.log('   ⚠️  Session expired, will login fresh');
          deleteStorageState();
          await executeLoginFlow(page, context, email, password);
        }
      }

      const navCheck = await page.locator('nav[role="navigation"], nav.global-nav, header[role="banner"]').count() > 0;
      const feedCheck = await page.locator('main, .feed-container, [data-testid="feed-container"]').count() > 0;
      const loginCheck = await page.locator('input[name="session_key"], .login-form').count() === 0;

      const isLoggedIn = (navCheck || feedCheck) && loginCheck;

      if (!isLoggedIn) {
        console.log('⚠️  Session expired, attempting fresh login...');
        deleteStorageState();
        await executeLoginFlow(page, context, email, password);
      } else {
        console.log('✅ Session verified');
      }
    }

    const postLoginReady = await waitForPostLoginReady(page);
    if (!postLoginReady) {
      console.warn('   ⚠️  Unable to confirm post-login layout before navigating to Catch Up');
    }

    let catchUpLoaded = false;
    let catchUpAttempts = 0;
    const maxCatchUpAttempts = 3;
    while (!catchUpLoaded && catchUpAttempts < maxCatchUpAttempts) {
      console.log(`\n   🔄 Catch-up page load attempt ${catchUpAttempts + 1}/${maxCatchUpAttempts}...`);
      console.log('   🔍 Checking browser state before catch-up load...');
      console.log(`   📋 Page is closed: ${page.isClosed()}`);
      console.log(`   📊 Context pages: ${context.pages().length}`);
      console.log(`   🔗 Browser connected: ${!browser.isConnected() ? 'disconnected' : 'connected'}`);
      
      catchUpLoaded = await loadCatchUpPage(page);
      if (!catchUpLoaded) {
        catchUpAttempts++;
        if (catchUpAttempts >= maxCatchUpAttempts) {
          console.log('   ⚠️  Max catch-up attempts reached, breaking...');
          break;
        }
        console.log(`   🔁 Retrying login (attempt ${catchUpAttempts + 1}) before catch-up`);
        await executeLoginFlow(page, context, email, password);
        const ready = await waitForPostLoginReady(page);
        if (!ready) {
          console.warn('   ⚠️  Post-login layout still not detected after retry');
        }
      } else {
        console.log('   ✅ Catch-up page loaded successfully');
      }
    }

    if (!catchUpLoaded) {
      throw new Error('Failed to reach Catch Up page after multiple login attempts');
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
    let stopRequested = false;
    let currentTab = 'All'; // Track which tab we're currently on: 'All', 'Job changes', 'Birthdays'
    let tabScrollAttempts = 0; // Track scroll attempts per tab
    // Helper function to get max scroll attempts based on current tab
    // Give "All" tab more attempts since it should have the most contacts
    const getMaxTabScrollAttempts = (tab: string) => tab === 'All' ? 15 : 10;
    
    // Use messages_per_job (default 50) instead of daily_limit
    // Allow environment variable override for testing
    const messagesPerJob = process.env.LINKEDIN_MAX_MESSAGES 
      ? parseInt(process.env.LINKEDIN_MAX_MESSAGES, 10)
      : (settings.messages_per_job || 50);
    console.log(`\n📊 LinkedIn Automation Settings:`);
    console.log(`   - Messages per job: ${messagesPerJob}`);
    console.log(`   - Batch size limit: 20 contacts per batch`);
    console.log(`   - Will process in batches until ${messagesPerJob} messages are sent\n`);
    
    // Continue scrolling until we reach messages_per_job limit or max scroll attempts
    while (totalSent < messagesPerJob && scrollAttempts < maxScrollAttempts) {
      // Check if page is still valid before extracting contacts
      if (!isPageValid(page)) {
        console.error('\n❌ Page/browser has been closed, stopping automation');
        result.errors.push('Browser/page was closed during automation');
        break;
      }

      // Limit batch size to avoid processing too many contacts at once
      // Recalculate each iteration since totalSent changes
      const remainingMessages = messagesPerJob - totalSent;
      const maxBatchSize = Math.min(remainingMessages, 20); // Process max 20 at a time

      // Extract currently visible contacts (limit batch size)
      console.log(`\n🔍 Extracting visible contacts (attempt ${scrollAttempts + 1}, batch limit: ${maxBatchSize})...`);
      let visibleContacts: Contact[] = [];
      try {
        visibleContacts = await extractContacts(page, maxBatchSize);
        visibleContacts = visibleContacts.filter(c => !processedProfileUrls.has(c.profileUrl));
      } catch (error: any) {
        if (error.message?.includes('Target page, context or browser has been closed')) {
          console.error('\n❌ Browser/page closed during contact extraction, stopping automation');
          result.errors.push('Browser/page was closed during contact extraction');
          break;
        }
        throw error;
      }
      
      if (visibleContacts.length === 0) {
        // Get max scroll attempts for current tab (All gets more attempts)
        const maxTabScrollAttempts = getMaxTabScrollAttempts(currentTab);
        
        // Increment scroll attempts BEFORE checking limit to fix off-by-one bug
        tabScrollAttempts++;
        console.log(`   ℹ️  No contacts found on ${currentTab} tab (scroll attempt ${tabScrollAttempts}/${maxTabScrollAttempts}).`);
        
        // Add diagnostic logging for "All" tab to understand why no contacts
        if (currentTab === 'All' && tabScrollAttempts <= 3) {
          try {
            const currentUrl = page.url();
            const messageLinksCount = await page.locator('a[href*="/messaging/compose/"]').count().catch(() => 0);
            const mainContainer = await page.locator('main').count().catch(() => 0);
            console.log(`   🔍 Diagnostic: URL=${currentUrl.includes('/all/') ? '✅ All tab' : '❌ Wrong tab'}, Message links=${messageLinksCount}, Main container=${mainContainer > 0 ? '✅ Found' : '❌ Missing'}`);
          } catch (diagError: any) {
            console.log(`   🔍 Diagnostic check failed: ${diagError.message}`);
          }
        }
        
        // NEW LOGIC: Scroll on current tab first, only switch tabs if no contacts after scrolling
        if (tabScrollAttempts <= maxTabScrollAttempts) {
          // Still scrolling on current tab
          console.log(`   📜 Scrolling down on ${currentTab} tab to load more contacts...`);
          scrollAttempts++;
          await scrollToLoadMore(page, container);
          await humanPause(2000, 3000);
          continue;
        } else {
          // Exhausted scroll attempts on current tab, try next tab
          console.log(`   ⚠️  No contacts found after ${maxTabScrollAttempts} scroll attempts on ${currentTab} tab.`);
          
          if (currentTab === 'All') {
            // Try "Job changes" tab next
            console.log('   🔄 Switching to "Job changes" tab...');
            try {
              await page.goto('https://www.linkedin.com/mynetwork/catch-up/job_changes/', { waitUntil: 'domcontentloaded', timeout: 30000 });
              await humanPause(2000, 3000);
              
              // Try clicking the tab button if available
              const tabButton = page.locator('button:has-text("Job changes"), button[aria-label*="Job changes" i]').first();
              const tabCount = await tabButton.count();
              if (tabCount > 0) {
                const isSelected = await tabButton.getAttribute('aria-selected').catch(() => 'false');
                if (isSelected !== 'true') {
                  await tabButton.click().catch(() => {});
                  await humanPause(2000, 3000);
                }
              }
              
              currentTab = 'Job changes';
              tabScrollAttempts = 0; // Reset scroll attempts for new tab
              console.log(`   ✅ Successfully switched to "${currentTab}" tab. Current URL: ${page.url()}`);
              continue; // Go back to extract contacts on new tab
            } catch (tabError: any) {
              console.log(`   ⚠️  Error switching to Job changes tab: ${tabError.message}`);
              // Fall through to try Birthdays tab
            }
          }
          
          if (currentTab === 'Job changes') {
            // Try "Birthdays" tab next
            console.log('   🔄 Switching to "Birthdays" tab...');
            try {
              await page.goto('https://www.linkedin.com/mynetwork/catch-up/birthday/', { waitUntil: 'domcontentloaded', timeout: 30000 });
              await humanPause(2000, 3000);
              
              // Try clicking the tab button if available
              const tabButton = page.locator('button:has-text("Birthdays"), button[aria-label*="Birthday" i]').first();
              const tabCount = await tabButton.count();
              if (tabCount > 0) {
                const isSelected = await tabButton.getAttribute('aria-selected').catch(() => 'false');
                if (isSelected !== 'true') {
                  await tabButton.click().catch(() => {});
                  await humanPause(2000, 3000);
                }
              }
              
              currentTab = 'Birthdays';
              tabScrollAttempts = 0; // Reset scroll attempts for new tab
              console.log(`   ✅ Successfully switched to "${currentTab}" tab. Current URL: ${page.url()}`);
              continue; // Go back to extract contacts on new tab
            } catch (tabError: any) {
              console.log(`   ⚠️  Error switching to Birthdays tab: ${tabError.message}`);
              // No more tabs to try, break
              console.log('   ⚠️  No more tabs to try. Stopping contact search.');
              break;
            }
          }
          
          if (currentTab === 'Birthdays') {
            // Already tried all tabs, no more contacts
            console.log('   ⚠️  Exhausted all tabs (All, Job changes, Birthdays). No more contacts found.');
            break;
          }
        }
      } else {
        // Found contacts - reset tab scroll attempts
        tabScrollAttempts = 0;
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
        // Check if page is still valid before processing each contact
        if (!isPageValid(page)) {
          console.error('\n❌ Page/browser has been closed, stopping contact processing');
          result.errors.push('Browser/page was closed during contact processing');
          stopRequested = true;
          break;
        }

        const contact = newContacts[contactIndex];
        console.log(`\n   [${contactIndex + 1}/${newContacts.length}] Starting to process: ${contact.name}`);
        // Check for stop signal
        const currentLock = readLockFile();
        if (currentLock?.status === 'stopping') {
          console.log('\n⏹️  Stop signal received, stopping gracefully...');
          stopRequested = true;
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
          processedProfileUrls.add(contact.profileUrl);
        } else {
          console.log(`   💬 Calling processContact for ${contact.name}...`);
          let processResult;
          try {
            processResult = await processContact(page, contact, settings, lockData);
          } catch (error: any) {
            // If browser/page was closed, stop processing immediately
            if (error.message?.includes('Target page, context or browser has been closed') || 
                error.message?.includes('browser has been closed')) {
              console.error(`\n❌ Browser/page closed while processing ${contact.name}, stopping automation`);
              result.errors.push(`Browser/page was closed while processing ${contact.name}`);
              stopRequested = true;
              break;
            }
            // Re-throw other errors
            throw error;
          }
          console.log(`   📊 Result for ${contact.name}: ${processResult.success ? '✅ Success' : '❌ Failed'}${processResult.error ? ` - ${processResult.error}` : ''}`);
          
          lockData.contactsProcessed++;
          if (processResult.success) {
            totalSent++;
            result.messagesSent++;
            lockData.messagesSent++;
            processedProfileUrls.add(contact.profileUrl);
            console.log(`   ✅ Message sent to ${contact.name} (${totalSent}/${messagesPerJob} this job)`);
          } else {
            result.messagesFailed++;
            lockData.messagesFailed++;
            
            // If error indicates browser closure, stop processing
            if (processResult.error?.includes('Target page, context or browser has been closed') ||
                processResult.error?.includes('browser has been closed')) {
              console.error(`\n❌ Browser/page closed (error: ${processResult.error}), stopping automation`);
              result.errors.push(`Browser/page was closed: ${processResult.error}`);
              stopRequested = true;
              break;
            }
            
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
      if (stopRequested) {
        console.log('\n⏹️ Stop signal handled, exiting processing loop');
        break;
      }

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
    console.error('   📊 Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 10).join('\n'),
      cause: error.cause
    });
    
    // Log browser/context/page state at error time
    try {
      console.log('   🔍 Browser state at error time:');
      console.log(`      Browser connected: ${browser ? (!browser.isConnected() ? 'disconnected' : 'connected') : 'null'}`);
      if (context) {
        console.log(`      Context pages: ${context.pages().length}`);
      } else {
        console.log('      Context: null');
      }
      if (page) {
        console.log(`      Page closed: ${page.isClosed()}`);
        try {
          console.log(`      Page URL: ${page.url()}`);
        } catch (urlError) {
          console.log(`      Page URL: (could not get - ${(urlError as Error).message})`);
        }
      } else {
        console.log('      Page: null');
      }
    } catch (stateError: any) {
      console.error('   ⚠️  Could not check browser state:', stateError.message);
    }
    
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
    console.log('   🧹 Cleaning up...');
    try {
      // Save final storage state if context exists
      if (context) {
        console.log('   💾 Saving storage state...');
        await context.storageState({ path: getStorageStatePath() });
        console.log('   ✅ Storage state saved');
      } else {
        console.log('   ⚠️  Context is null, cannot save storage state');
      }
    } catch (e: any) {
      console.warn('   ⚠️  Could not save storage state:', e.message);
      console.warn('   📊 Storage state error details:', {
        name: e.name,
        stack: e.stack?.split('\n').slice(0, 3).join('\n')
      });
    }
    
    // Update lock file
    lockData.status = 'stopped';
    writeLockFile(lockData);
    
    // Close page/context/browser to avoid lingering Chromium processes
    try {
      if (page && !page.isClosed()) {
        console.log('   🔒 Closing page...');
        await page.close();
        console.log('   ✅ Page closed');
      }
      if (context) {
        console.log('   🔒 Closing context...');
        await context.close();
        console.log('   ✅ Context closed');
      }
      console.log('   🔒 Closing browser...');
      if (browser) {
        console.log(`   📊 Browser connected before close: ${!browser.isConnected() ? 'disconnected' : 'connected'}`);
        await browser.close();
        console.log('   ✅ Browser closed successfully');
      } else {
        console.log('   ⚠️  Browser is null, cannot close');
      }
    } catch (e: any) {
      console.warn('   ⚠️  Error closing browser:', e.message);
      console.warn('   📊 Browser close error details:', {
        name: e.name,
        stack: e.stack?.split('\n').slice(0, 3).join('\n')
      });
    }
    
    console.log('\n✅ Automation completed');
    console.log(`   📊 Results: ${result.messagesSent} sent, ${result.messagesFailed} failed, ${result.messagesSkipped} skipped`);
  }
  
  return result;
}

// Run if executed directly (Bun check)
if ((import.meta as any).main || process.argv[1]?.includes('linkedin.ts')) {
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
