#!/usr/bin/env bun
/**
 * Script to inspect EdgeProp login page and find the correct selectors
 */

import { chromium } from 'playwright';

async function inspectLogin() {
  console.log('🔍 Inspecting EdgeProp login page...');
  
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
    extraHTTPHeaders: {
      'Accept-Language': 'en-SG,en;q=0.9',
    }
  });

  // Remove automation indicators
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    (window as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome = {
      runtime: {},
    };
  });

  const page = await context.newPage();
  
  await page.goto('https://www.edgeprop.sg/user/login');
  console.log('📄 Navigated to EdgeProp login page');
  console.log('⏳ Waiting for page to load...');
  await page.waitForTimeout(3000);
  
  // Take a snapshot to see the page structure
  console.log('📸 Taking snapshot of the page...');
  const title = await page.title();
  console.log(`📄 Page title: ${title}`);
  
  // Check for email and password inputs
  console.log('\n🔍 Searching for login form elements...');
  
  // Look for email input
  const emailInputs = await page.locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i], input[placeholder*="Email" i]').all();
  console.log(`Found ${emailInputs.length} potential email inputs`);
  for (let i = 0; i < emailInputs.length; i++) {
    const placeholder = await emailInputs[i].getAttribute('placeholder').catch(() => '');
    const name = await emailInputs[i].getAttribute('name').catch(() => '');
    const id = await emailInputs[i].getAttribute('id').catch(() => '');
    console.log(`  Email input ${i + 1}: placeholder="${placeholder}", name="${name}", id="${id}"`);
  }
  
  // Look for password input
  const passwordInputs = await page.locator('input[type="password"], input[name*="password" i], input[placeholder*="password" i]').all();
  console.log(`Found ${passwordInputs.length} potential password inputs`);
  for (let i = 0; i < passwordInputs.length; i++) {
    const placeholder = await passwordInputs[i].getAttribute('placeholder').catch(() => '');
    const name = await passwordInputs[i].getAttribute('name').catch(() => '');
    const id = await passwordInputs[i].getAttribute('id').catch(() => '');
    console.log(`  Password input ${i + 1}: placeholder="${placeholder}", name="${name}", id="${id}"`);
  }
  
  // Look for login/submit buttons
  const buttons = await page.locator('button, input[type="submit"]').all();
  console.log(`\nFound ${buttons.length} buttons on the page`);
  const loginButtons = [];
  for (let i = 0; i < buttons.length; i++) {
    const text = await buttons[i].textContent().catch(() => '');
    const type = await buttons[i].getAttribute('type').catch(() => '');
    const className = await buttons[i].getAttribute('class').catch(() => '');
    if (text.toLowerCase().includes('log') || text.toLowerCase().includes('sign') || text.toLowerCase().includes('submit') || type === 'submit') {
      loginButtons.push({ index: i, text: text.trim(), type, className });
    }
  }
  
  console.log('\n🔘 Potential login buttons:');
  for (const btn of loginButtons) {
    console.log(`  Button ${btn.index}: "${btn.text}" (type="${btn.type}", class="${btn.className.substring(0, 50)}")`);
  }
  
  // Look for any form elements
  const forms = await page.locator('form').all();
  console.log(`\n📋 Found ${forms.length} forms on the page`);
  for (let i = 0; i < forms.length; i++) {
    const action = await forms[i].getAttribute('action').catch(() => '');
    const method = await forms[i].getAttribute('method').catch(() => '');
    console.log(`  Form ${i + 1}: action="${action}", method="${method}"`);
  }
  
  console.log('\n✅ Inspection complete! Please review the output above.');
  console.log('📸 The browser will stay open for 60 seconds so you can manually inspect the page...');
  await page.waitForTimeout(60000);
  
  await browser.close();
  console.log('🔚 Browser closed');
}

inspectLogin().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

