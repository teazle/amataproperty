#!/usr/bin/env bun
/**
 * Manual EdgeProp login with credentials
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function loginEdgeProp() {
  const email = 'vintester01@gmail.com';
  const password = 'Testing123!';
  
  console.log('🚀 Launching browser for EdgeProp login...');
  
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
    colorScheme: 'light',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  
  // Go to main page and look for login
  await page.goto('https://www.edgeprop.sg/');
  console.log('📄 Navigated to homepage');
  await page.waitForTimeout(3000);
  
  // Look for any text that says Login or Sign In in the visible area
  console.log('🔍 Looking for login button...');
  
  // Try clicking on any element with "Login" or "Sign In" text
  const loginButton = page.locator('text=/Login|Sign In|Sign Up/i').first();
  const isVisible = await loginButton.isVisible().catch(() => false);
  
  if (isVisible) {
    console.log('✅ Found login button, clicking...');
    await loginButton.click();
    await page.waitForTimeout(2000);
    
    // Now try to fill in credentials
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);
    
    // Look for email and password fields
    const emailInput = page.locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i]').first();
    const emailVisible = await emailInput.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (emailVisible) {
      console.log('📧 Found email input, entering...');
      await emailInput.fill(email);
      await page.waitForTimeout(1000);
      
      const passwordInput = page.locator('input[type="password"]').first();
      await passwordInput.fill(password);
      console.log('🔑 Password entered');
      await page.waitForTimeout(1000);
      
      // Look for submit button
      const submitButton = page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")').first();
      await submitButton.click();
      console.log('🔄 Clicked submit, waiting...');
      await page.waitForTimeout(5000);
      
      console.log(`📍 After login URL: ${page.url()}`);
    } else {
      console.log('⚠️ Email input not visible after clicking login');
    }
  } else {
    console.log('⚠️ Login button not found');
  }
  
  // Wait for login to complete or manual intervention
  console.log('\n⏳ Waiting 60 seconds for login to complete...');
  await page.waitForTimeout(60000);
  
  // Save state
  const storagePath = path.join(process.cwd(), 'storage');
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }
  
  const stateFilePath = path.join(storagePath, 'ep.state.json');
  await context.storageState({ path: stateFilePath });
  console.log(`💾 Saved state to: ${stateFilePath}`);
  
  await browser.close();
  console.log('✅ Done!');
}

loginEdgeProp().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

