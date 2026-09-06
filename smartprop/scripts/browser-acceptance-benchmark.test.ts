import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserType } from 'playwright';
import { chromium } from 'playwright';

import { runBrowserAcceptance } from './browser-acceptance-benchmark';

let fixtureDirectory = '';

function fixturePath(name: string) {
  return join(fixtureDirectory, name);
}

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'smartprop-browser-acceptance-test-'));

  await Promise.all([
    writeFile(fixturePath('article.html'), `<!doctype html>
      <html><head><title>EdgeProp market report</title></head><body>
        <main><article><h1>Home sales improve as buyers return</h1>
          <div class="detail-content">
            <p>Home sales improved this month after buyers returned to the market with renewed confidence and clearer financing options.</p>
            <p>Agents reported that well-priced homes attracted several viewings, while sellers adjusted expectations to match recent transactions.</p>
          </div>
        </article></main>
      </body></html>`),
    writeFile(fixturePath('challenge.html'), `<!doctype html>
      <html><head><title>www.edgeprop.sg</title></head><body>
        <main class="challenge-content">
          <h1>www.edgeprop.sg</h1>
          <h2>Performing security verification</h2>
          <p>This website uses a security service to protect against malicious bots. This page is displayed while the website verifies you are not a bot.</p>
          <p>Verification successful. Waiting for www.edgeprop.sg to respond.</p>
          <span id="challenge-error-text">Enable JavaScript and cookies to continue</span>
        </main>
      </body></html>`),
    writeFile(fixturePath('empty.html'), `<!doctype html>
      <html><head><title>Empty article fixture</title></head><body>
        <main><article><h1>Empty article fixture</h1><div class="detail-content"></div></article></main>
      </body></html>`),
    writeFile(fixturePath('editorial-cloudflare.html'), `<!doctype html>
      <html><head><title>Technology explainer</title></head><body>
        <main><article><h1>Why Cloudflare verification appears during property searches</h1>
          <div class="detail-content">
            <p>Cloudflare security verification can appear when a visitor changes networks, according to researchers reviewing property search traffic.</p>
            <p>The publisher said this verification protects readers without changing the editorial article itself or preventing ordinary access.</p>
          </div>
        </article></main>
      </body></html>`),
  ]);
});

afterAll(async () => {
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

describe('provider-free browser acceptance benchmark', () => {
  test('classifies rendered local article, challenge, empty, and editorial fixtures', async () => {
    const results = await runBrowserAcceptance([
      { id: 'article', path: fixturePath('article.html') },
      { id: 'challenge', path: fixturePath('challenge.html') },
      { id: 'empty', path: fixturePath('empty.html') },
      { id: 'editorial-cloudflare', path: fixturePath('editorial-cloudflare.html') },
    ], { launchOptions: { channel: 'chrome' } });

    expect(results.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'article', status: 'valid' },
      { id: 'challenge', status: 'blocked' },
      { id: 'empty', status: 'empty' },
      { id: 'editorial-cloudflare', status: 'valid' },
    ]);
    expect(results[0]).toMatchObject({
      validationReason: 'valid',
      page: { title: 'EdgeProp market report' },
      title: { value: 'Home sales improve as buyers return', selector: 'h1', length: 35 },
      body: { selector: '.detail-content' },
    });
    expect(results[0].body.textLength).toBeGreaterThan(200);
    expect(results[0].body.textExcerpt).toContain('Home sales improved this month');
    expect(results[1]).toMatchObject({ status: 'blocked', validationReason: 'challenge' });
    expect(results[2]).toMatchObject({ status: 'empty', validationReason: 'empty' });
    expect(results[3].body.textExcerpt).toContain('Cloudflare security verification');
    expect(results.every((result) => result.timing.durationMs >= 0)).toBe(true);
  }, 20_000);

  test('rejects external URL inputs before launching a browser', async () => {
    await expect(runBrowserAcceptance([
      { id: 'external', path: 'https://www.edgeprop.sg/property-news/example' },
    ])).rejects.toThrow('Local fixture paths only');
  });

  test('closes the real browser and context after a per-sample navigation error', async () => {
    let launchedBrowser: Browser | undefined;
    let browserDisconnected = false;
    let contextClosed = false;

    const observingBrowserType = new Proxy(chromium, {
      get(target, property, receiver) {
        if (property !== 'launch') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<BrowserType['launch']>) => {
          launchedBrowser = await target.launch(...args);
          launchedBrowser.once('disconnected', () => {
            browserDisconnected = true;
          });
          launchedBrowser.on('disconnected', () => {
            contextClosed = launchedBrowser?.contexts().length === 0;
          });
          return launchedBrowser;
        };
      },
    });

    const results = await runBrowserAcceptance([
      { id: 'missing', path: fixturePath('missing.html') },
    ], {
      browserType: observingBrowserType,
      launchOptions: { channel: 'chrome' },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'missing', status: 'error' });
    expect(results[0].error).toContain('net::ERR_FILE_NOT_FOUND');
    expect(launchedBrowser?.isConnected()).toBe(false);
    expect(browserDisconnected).toBe(true);
    expect(contextClosed).toBe(true);
  }, 20_000);
});
