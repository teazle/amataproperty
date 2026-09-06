#!/usr/bin/env bun

import { config } from 'dotenv';
import { readFileSync } from 'fs';
import puppeteer, { type Browser, type ElementHandle, type Page } from 'puppeteer-core';
import {
  renderLinkedInNewsletterMessage,
  shouldSuppressNewsletterRecipient,
  validateApprovedLinkedInNewsletterBatch,
  type ApprovedLinkedInNewsletterBatch,
} from '../src/lib/linkedin/newsletter';
import {
  getLastLinkedInNewsletterSentAt,
  listApprovedLinkedInNewsletterRecipients,
  updateLinkedInNewsletterRecipientStatus,
  upsertApprovedLinkedInNewsletterCampaign,
  upsertLinkedInNewsletterRecipients,
} from '../src/lib/linkedin/newsletter-store';

config({ path: '/root/.openclaw/workspace/linkedin.env', override: false, quiet: true });
config({ path: '.env.local', override: false, quiet: true });
config({ path: '.env', override: false, quiet: true });

const BROWSER_USE_API = 'https://api.browser-use.com/api/v3';
const DEFAULT_OPENCLAW_CDP_URL = 'http://127.0.0.1:18800';

type BrowserSession = {
  browser: Browser;
  page: Page;
  stop: () => Promise<void>;
};

function argValue(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function browserUseFetch<T>(pathName: string, method: string, body?: unknown): Promise<T> {
  if (!process.env.BROWSER_USE_API_KEY) {
    throw new Error('BROWSER_USE_API_KEY is required when LINKEDIN_BROWSER_CDP_URL is not set');
  }

  const response = await fetch(`${BROWSER_USE_API}${pathName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Browser-Use-API-Key': process.env.BROWSER_USE_API_KEY,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Browser Use API ${method} ${pathName} failed: ${response.status} ${text.slice(0, 500)}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

async function connectLinkedInBrowser(): Promise<BrowserSession> {
  const configuredCdp =
    argValue('--cdp-url') ||
    process.env.LINKEDIN_NEWSLETTER_CDP_URL ||
    process.env.OPENCLAW_BROWSER_CDP_URL ||
    process.env.LINKEDIN_BROWSER_CDP_URL ||
    DEFAULT_OPENCLAW_CDP_URL;
  const explicitCdp = Boolean(
    argValue('--cdp-url') ||
    process.env.LINKEDIN_NEWSLETTER_CDP_URL ||
    process.env.OPENCLAW_BROWSER_CDP_URL ||
    process.env.LINKEDIN_BROWSER_CDP_URL,
  );

  try {
    const browser = await connectOverCdp(configuredCdp);
    const pages = await browser.pages();
    const page = pages.find((candidate) => /linkedin\.com/i.test(candidate.url())) || pages[0] || await browser.newPage();
    return {
      browser,
      page,
      stop: async () => {
        await browser.disconnect();
      },
    };
  } catch (error) {
    if (explicitCdp) {
      throw error;
    }
    console.warn(`[send] local OpenClaw CDP unavailable at ${configuredCdp}; falling back to Browser Use cloud`);
  }

  const profileId = process.env.LINKEDIN_BROWSER_USE_PROFILE_ID || process.env.BROWSER_USE_PROFILE_ID;
  const profileName = process.env.LINKEDIN_BROWSER_USE_PROFILE_NAME || process.env.BROWSER_USE_PROFILE_NAME || 'smartprop-linkedin';
  const cloud = await browserUseFetch<{ id: string; cdpUrl: string }>('/browsers', 'POST', {
    profileId,
    profileName: profileId ? undefined : profileName,
    proxyCountryCode: process.env.LINKEDIN_BROWSER_USE_PROXY_COUNTRY || 'sg',
    browserScreenWidth: Number(process.env.LINKEDIN_BROWSER_USE_SCREEN_WIDTH || 1280),
    browserScreenHeight: Number(process.env.LINKEDIN_BROWSER_USE_SCREEN_HEIGHT || 900),
    timeout: Number(process.env.LINKEDIN_BROWSER_USE_TIMEOUT_MINUTES || 45),
    allowResizing: true,
  });

  const browser = await connectOverCdp(cloud.cdpUrl);
  const pages = await browser.pages();
  const page = pages.find((candidate) => /linkedin\.com/i.test(candidate.url())) || pages[0] || await browser.newPage();

  return {
    browser,
    page,
    stop: async () => {
      browser.disconnect?.();
      await browserUseFetch(`/browsers/${cloud.id}`, 'PATCH', { action: 'stop' }).catch(() => undefined);
    },
  };
}

async function connectOverCdp(cdpUrl: string): Promise<Browser> {
  if (/^wss?:\/\//i.test(cdpUrl)) {
    return puppeteer.connect({ browserWSEndpoint: cdpUrl, protocolTimeout: 60000 });
  }
  return puppeteer.connect({ browserURL: cdpUrl, protocolTimeout: 60000 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readApprovedBatch(path: string): ApprovedLinkedInNewsletterBatch {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return validateApprovedLinkedInNewsletterBatch(raw);
}

async function findMessageButton(page: Page): Promise<ElementHandle<Element>> {
  const handle = await page.evaluateHandle(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, a, [aria-label*="Message"]'));
    return candidates.find((element) => {
      const label = `${element.innerText || ''} ${element.getAttribute('aria-label') || ''}`;
      const rect = element.getBoundingClientRect();
      return /message/i.test(label) && rect.width > 0 && rect.height > 0;
    }) || null;
  });
  const element = handle.asElement();
  if (element) {
    return element;
  }
  throw new Error('Could not find LinkedIn Message button');
}

async function findComposeBox(page: Page): Promise<ElementHandle<Element>> {
  const selectors = [
    'div.msg-form__contenteditable[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"][aria-label*="message" i]',
    'textarea[name="message"]',
  ];
  for (const selector of selectors) {
    const handles = await page.$$(selector);
    for (const handle of handles.reverse()) {
      const box = await handle.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) {
        return handle;
      }
    }
  }
  throw new Error('Could not find LinkedIn compose box');
}

async function setComposeText(composeBox: ElementHandle<Element>, message: string): Promise<void> {
  await composeBox.evaluate((el, text) => {
    const target = el as HTMLElement & { value?: string };
    target.focus();
    if ('value' in target) {
      target.value = text;
    } else {
      target.innerHTML = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      target.textContent = text;
    }
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }, message);
}

async function sendLinkedInProfileMessage(page: Page, profileUrl: string, message: string, actuallySend: boolean): Promise<void> {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);

  if (/linkedin\.com\/(login|checkpoint|challenge|authwall)/i.test(page.url())) {
    throw new Error('LinkedIn session is not authenticated or is at a checkpoint');
  }

  const messageButton = await findMessageButton(page);
  await messageButton.click();
  await sleep(1500);

  const composeBox = await findComposeBox(page);
  await setComposeText(composeBox, message);
  await sleep(750);

  const typed = await composeBox.evaluate((el) => (el as HTMLElement & { value?: string }).innerText || (el as HTMLTextAreaElement).value || el.textContent || '');
  if (!typed.includes(message.slice(0, Math.min(40, message.length)))) {
    throw new Error('Refusing to send: compose box does not contain the approved message');
  }

  if (!actuallySend) return;

  const sendButtonHandle = await page.evaluateHandle(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>('button, button[type="submit"]'));
    return candidates.reverse().find((button) => {
      const label = `${button.innerText || ''} ${button.getAttribute('aria-label') || ''}`;
      const rect = button.getBoundingClientRect();
      return /send/i.test(label) && rect.width > 0 && rect.height > 0 && !button.disabled;
    }) || null;
  });
  const sendButton = sendButtonHandle.asElement();
  if (!sendButton) {
    throw new Error('Could not find LinkedIn Send button');
  }
  await sendButton.click();
  await sleep(2000);
}

async function main() {
  const batchPath = argValue('--batch');
  if (!batchPath) {
    throw new Error('Usage: bun scripts/linkedin-newsletter-send.ts --batch <approved-openclaw-batch.json> [--cdp-url <url>] [--limit 10] [--prepare] [--send]');
  }

  const batch = readApprovedBatch(batchPath);
  const limit = Number(argValue('--limit', process.env.LINKEDIN_NEWSLETTER_SEND_LIMIT || '10'));
  const prepareOnly = hasFlag('--prepare');
  const actuallySend = hasFlag('--send');
  if (actuallySend && process.env.LINKEDIN_NEWSLETTER_ALLOW_SEND !== 'true') {
    throw new Error('Set LINKEDIN_NEWSLETTER_ALLOW_SEND=true before using --send');
  }

  if (!prepareOnly && !actuallySend) {
    const previews = batch.recipients.slice(0, limit).map((recipient) => ({
      name: recipient.name,
      profileUrl: recipient.profileUrl,
      chars: renderLinkedInNewsletterMessage({
        template: batch.linkedinMessageTemplate,
        recipientName: recipient.name,
        newsletterTitle: batch.newsletterTitle,
        newsletterUrl: batch.newsletterUrl,
      }).length,
    }));
    console.log(JSON.stringify({
      mode: 'validate-only',
      campaignSlug: batch.campaignSlug,
      approvedBy: batch.approvedBy,
      approvedAt: batch.approvedAt,
      recipients: batch.recipients.length,
      previews,
    }, null, 2));
    return;
  }

  const campaignId = await upsertApprovedLinkedInNewsletterCampaign(batch);
  await upsertLinkedInNewsletterRecipients(campaignId, batch.recipients, 'approved');
  const recipients = await listApprovedLinkedInNewsletterRecipients(batch.campaignSlug, limit);

  const session = actuallySend ? await connectLinkedInBrowser() : null;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (const recipient of recipients) {
      const lastSentAt = await getLastLinkedInNewsletterSentAt(recipient.profile_url, recipient.campaign_id);
      if (shouldSuppressNewsletterRecipient({ lastSentAt })) {
        skipped += 1;
        await updateLinkedInNewsletterRecipientStatus(recipient.id, {
          status: 'skipped_duplicate',
          error: lastSentAt ? `Recent LinkedIn newsletter DM sent at ${lastSentAt}` : null,
        });
        continue;
      }

      const message = renderLinkedInNewsletterMessage({
        template: batch.linkedinMessageTemplate,
        recipientName: recipient.name,
        newsletterTitle: batch.newsletterTitle,
        newsletterUrl: batch.newsletterUrl,
      });

      if (!actuallySend) {
        console.log(`[prepare] ${recipient.name} <${recipient.profile_url}> ${message.length} chars`);
        await updateLinkedInNewsletterRecipientStatus(recipient.id, {
          status: 'queued',
          messageBody: message,
        });
        continue;
      }

      try {
        await sendLinkedInProfileMessage(session!.page, recipient.profile_url, message, true);
        sent += 1;
        await updateLinkedInNewsletterRecipientStatus(recipient.id, {
          status: 'sent',
          messageBody: message,
          sentAt: new Date().toISOString(),
        });
      } catch (error) {
        failed += 1;
        await updateLinkedInNewsletterRecipientStatus(recipient.id, {
          status: 'failed',
          messageBody: message,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await session?.stop();
  }

  console.log(JSON.stringify({
    campaignSlug: batch.campaignSlug,
    mode: actuallySend ? 'send' : 'prepare',
    considered: recipients.length,
    sent,
    skipped,
    failed,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
