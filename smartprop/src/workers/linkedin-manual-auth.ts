#!/usr/bin/env bun

import { chromium } from 'playwright-ghost';
import plugins from 'playwright-ghost/plugins';
import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';
import {
  getStorageStatePath,
  deleteStorageState
} from '@/lib/linkedin/storage';

config({ path: '.env.local' });
config();

const MANUAL_TIMEOUT_MS = process.env.LINKEDIN_MANUAL_CHALLENGE_TIMEOUT_MS
  ? parseInt(process.env.LINKEDIN_MANUAL_CHALLENGE_TIMEOUT_MS, 10)
  : 600000;

function isAuthenticatedUrl(url: string): boolean {
  return /linkedin\.com\/(feed|mynetwork|in\/)/i.test(url) &&
    !/linkedin\.com\/(login|checkpoint|challenge|uas\/login)/i.test(url);
}

async function run(): Promise<void> {
  console.log('🔐 Launching LinkedIn manual auth helper...');
  console.log(`⏳ Waiting up to ${Math.floor(MANUAL_TIMEOUT_MS / 1000)} seconds for you to finish login`);

  deleteStorageState();

  const browser = await chromium.launch({
    headless: false,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    plugins: plugins.recommended({
      polyfill: true,
      humanize: true,
    }),
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-software-rasterizer'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: process.env.TZ || 'Asia/Singapore'
  });

  const page = await context.newPage();
  await page.goto('https://www.linkedin.com/login', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.log(`🌐 Opened: ${page.url()}`);
  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;
  if (email && password) {
    try {
      await page.evaluate(
        ({ emailValue, passwordValue }) => {
          const isVisible = (el: HTMLElement) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== 'hidden' &&
              style.display !== 'none' &&
              !el.hasAttribute('disabled');
          };

          const setInput = (selector: string, value: string) => {
            const input = Array.from(document.querySelectorAll<HTMLInputElement>(selector)).find(isVisible);
            if (!input) {
              throw new Error(`Visible input not found: ${selector}`);
            }
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          };

          setInput('input[name="session_key"], input#username, input[autocomplete*="username"], input[type="email"]', emailValue);
          setInput('input[name="session_password"], input#password, input[autocomplete*="current-password"], input[type="password"]', passwordValue);
        },
        { emailValue: email, passwordValue: password }
      );
      await page.getByRole('button', { name: 'Sign in', exact: true }).first().click({ timeout: 10000 });
      console.log('🔑 Submitted LinkedIn credentials from .env');
    } catch (error) {
      console.warn('⚠️ Could not auto-submit credentials; complete login manually:', (error instanceof Error ? error.message : String(error)));
    }
  }
  console.log('👀 Complete any remaining login challenge manually in the visible browser window');

  const startedAt = Date.now();
  let authenticated = false;

  while ((Date.now() - startedAt) < MANUAL_TIMEOUT_MS) {
    await page.waitForTimeout(3000);
    const currentUrl = page.url();

    if (isAuthenticatedUrl(currentUrl)) {
      const hasNav = await page.locator('nav[role="navigation"], nav.global-nav, header[role="banner"]').count().catch(() => 0);
      const hasLoginForm = await page.locator('input[name="session_key"], input[name="session_password"], form[action*="login"]').count().catch(() => 0);

      if ((hasNav > 0 || currentUrl.includes('/feed') || currentUrl.includes('/mynetwork')) && hasLoginForm === 0) {
        authenticated = true;
        console.log(`✅ LinkedIn session detected at ${currentUrl}`);
        break;
      }
    }

    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    console.log(`   ⏳ Waiting for manual login... (${elapsed}s elapsed) URL=${currentUrl}`);
  }

  if (!authenticated) {
    throw new Error('Manual LinkedIn auth timed out before a valid logged-in page was detected');
  }

  const storagePath = getStorageStatePath();
  await context.storageState({ path: storagePath });

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

    const storageDir = path.dirname(storagePath);
    fs.writeFileSync(
      path.join(storageDir, 'linkedin.sessionStorage.json'),
      JSON.stringify(sessionStorage, null, 2)
    );
  } catch (error) {
    console.warn('⚠️ Could not save sessionStorage:', (error instanceof Error ? error.message : String(error)));
  }

  console.log('💾 Saved LinkedIn session successfully');
  await browser.close();
}

run().catch((error) => {
  console.error('❌ Manual LinkedIn auth failed:', error);
  process.exit(1);
});
