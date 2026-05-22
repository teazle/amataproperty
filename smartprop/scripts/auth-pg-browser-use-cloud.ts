import fs from 'fs';
import path from 'path';

const BROWSER_USE_API = 'https://api.browser-use.com/api/v3';
const PROPERTYGURU_ORIGIN = 'https://www.propertyguru.com.sg';

type BrowserUseBrowser = {
  id: string;
  cdpUrl: string;
  liveUrl?: string;
};

type CdpResponse = {
  id?: number;
  result?: any;
  error?: { message?: string; code?: number };
};

class CdpClient {
  private id = 0;
  private pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  private constructor(private ws: WebSocket) {
    ws.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data as ArrayBuffer).toString('utf-8');
      const message = JSON.parse(raw) as CdpResponse;
      if (!message.id) return;

      const request = this.pending.get(message.id);
      if (!request) return;

      clearTimeout(request.timer);
      this.pending.delete(message.id);

      if (message.error) {
        request.reject(new Error(message.error.message || `CDP error ${message.error.code ?? 'unknown'}`));
      } else {
        request.resolve(message.result ?? {});
      }
    };

    ws.onclose = () => {
      for (const [requestId, request] of this.pending.entries()) {
        clearTimeout(request.timer);
        request.reject(new Error(`CDP websocket closed while waiting for request ${requestId}`));
      }
      this.pending.clear();
    };
  }

  static connect(url: string, timeoutMs = 120_000): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Timed out connecting to Browser Use CDP websocket after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new CdpClient(ws));
      };

      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Browser Use CDP websocket failed to connect'));
      };
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 120_000): Promise<any> {
    const id = ++this.id;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    this.ws.close();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function browserUseFetch<T>(pathName: string, method: string, body?: unknown): Promise<T> {
  const apiKey = requireEnv('BROWSER_USE_API_KEY');
  const response = await fetch(`${BROWSER_USE_API}${pathName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Browser-Use-API-Key': apiKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Browser Use API ${method} ${pathName} failed: ${response.status} ${text.slice(0, 500)}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

async function createCloudBrowser(): Promise<BrowserUseBrowser> {
  const timeout = Number(process.env.BROWSER_USE_TIMEOUT_MINUTES || 30);
  return browserUseFetch<BrowserUseBrowser>('/browsers', 'POST', {
    proxyCountryCode: process.env.BROWSER_USE_PROXY_COUNTRY || 'sg',
    timeout,
    browserScreenWidth: 1512,
    browserScreenHeight: 736,
    allowResizing: true,
  });
}

async function stopCloudBrowser(browserId: string | undefined) {
  if (!browserId) return;
  try {
    await browserUseFetch(`/browsers/${browserId}`, 'PATCH', { action: 'stop' });
  } catch (error) {
    console.warn(`⚠️  Failed to stop Browser Use cloud browser ${browserId}:`, error);
  }
}

async function resolveCdpWs(cdpUrl: string): Promise<string> {
  const versionUrl = `${cdpUrl.replace(/\/$/, '')}/json/version`;
  const response = await fetch(versionUrl);
  if (!response.ok) {
    throw new Error(`Could not read Browser Use CDP version endpoint: ${response.status}`);
  }
  const version = await response.json() as { webSocketDebuggerUrl?: string };
  if (!version.webSocketDebuggerUrl) {
    throw new Error('Browser Use CDP version endpoint did not return webSocketDebuggerUrl');
  }
  return version.webSocketDebuggerUrl;
}

async function createPageSession(cdp: CdpClient): Promise<string> {
  const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId as string;
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);
  return sessionId;
}

async function evaluate<T>(cdp: CdpClient, sessionId: string, expression: string): Promise<T> {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);

  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'JavaScript evaluation failed');
  }

  return response.result?.value as T;
}

async function gotoUrl(cdp: CdpClient, sessionId: string, url: string) {
  await cdp.send('Page.navigate', { url }, sessionId);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const ready = await evaluate<string>(cdp, sessionId, 'document.readyState').catch(() => 'loading');
    if (ready === 'interactive' || ready === 'complete') return;
    await Bun.sleep(300);
  }
  throw new Error(`Timed out waiting for ${url} to start loading`);
}

async function waitForVisible(cdp: CdpClient, sessionId: string, selector: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  const quoted = JSON.stringify(selector);
  while (Date.now() < deadline) {
    const found = await evaluate<boolean>(cdp, sessionId, `
      (() => {
        const e = document.querySelector(${quoted});
        if (!e) return false;
        return !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
      })()
    `).catch(() => false);
    if (found) return;
    await Bun.sleep(500);
  }
  throw new Error(`Timed out waiting for visible selector: ${selector}`);
}

async function setInputValue(cdp: CdpClient, sessionId: string, selector: string, value: string) {
  await waitForVisible(cdp, sessionId, selector);
  await evaluate(cdp, sessionId, `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) throw new Error('input not found');
      input.scrollIntoView({ block: 'center' });
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `);
}

async function clickVisibleButton(cdp: CdpClient, sessionId: string, labelPattern: string) {
  const clicked = await evaluate<boolean>(cdp, sessionId, `
    (() => {
      const matcher = new RegExp(${JSON.stringify(labelPattern)}, 'i');
      const isVisible = (element) => !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
      const button = Array.from(document.querySelectorAll('button'))
        .find((candidate) => isVisible(candidate) && matcher.test((candidate.textContent || '').trim()));
      if (!button) return false;
      button.scrollIntoView({ block: 'center' });
      button.click();
      return true;
    })()
  `);
  if (!clicked) throw new Error(`Could not find visible button matching ${labelPattern}`);
}

async function isCloudflareBlocked(cdp: CdpClient, sessionId: string): Promise<boolean> {
  const text = await evaluate<string>(cdp, sessionId, `
    document.body ? (document.body.innerText || document.body.textContent || '') : ''
  `).catch(() => '');
  return /cloudflare|security verification|enable javascript|verify you are human|just a moment/i.test(text);
}

async function waitForPropertyGuruLoginReady(cdp: CdpClient, sessionId: string, timeoutMs = 90_000) {
  const emailSelector = 'input[type="email"], input[name="email-fld"], input[placeholder*="Email" i]';
  const deadline = Date.now() + timeoutMs;
  let lastText = '';

  while (Date.now() < deadline) {
    const state = await evaluate<{ hasEmail: boolean; blocked: boolean; text: string }>(cdp, sessionId, `
      (() => {
        const text = document.body ? (document.body.innerText || document.body.textContent || '') : '';
        const email = document.querySelector(${JSON.stringify(emailSelector)});
        const hasEmail = !!email && !!(email.offsetWidth || email.offsetHeight || email.getClientRects().length);
        return {
          hasEmail,
          blocked: /cloudflare|security verification|enable javascript|verify you are human|just a moment/i.test(text),
          text: text.slice(0, 300),
        };
      })()
    `).catch(() => ({ hasEmail: false, blocked: false, text: '' }));

    if (state.hasEmail) return;
    lastText = state.text;
    await Bun.sleep(2_000);
  }

  throw new Error(`PropertyGuru login form did not become ready. Last page text: ${lastText}`);
}

async function verifyLoggedIn(cdp: CdpClient, sessionId: string): Promise<boolean> {
  await gotoUrl(cdp, sessionId, `${PROPERTYGURU_ORIGIN}/user/login`);
  await Bun.sleep(8_000);
  if (await isCloudflareBlocked(cdp, sessionId)) return false;

  const state = await evaluate<{
    url: string;
    hasLoginEmail: boolean;
    hasPassword: boolean;
    accountHints: boolean;
    loginText: boolean;
  }>(cdp, sessionId, `
    (() => {
      const text = document.body?.innerText || document.body?.textContent || '';
      return {
        url: location.href,
        hasLoginEmail: !!document.querySelector('input[type="email"], input[name="email-fld"]'),
        hasPassword: !!document.querySelector('input[type="password"]'),
        accountHints: /my activities|logout|log out|my account|saved properties|shortlist|profile/i.test(text),
        loginText: /welcome to propertyguru|log in or sign up|log in with password/i.test(text),
      };
    })()
  `);

  return !state.hasLoginEmail && !state.hasPassword && !state.loginText && (
    state.accountHints || state.url === `${PROPERTYGURU_ORIGIN}/` || state.url.startsWith(`${PROPERTYGURU_ORIGIN}/?`)
  );
}

function normalizeCookie(cookie: Record<string, any>) {
  const sameSite = ['Strict', 'Lax', 'None'].includes(cookie.sameSite) ? cookie.sameSite : undefined;
  const normalized: Record<string, unknown> = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    expires: typeof cookie.expires === 'number' ? cookie.expires : -1,
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
  };
  if (sameSite) normalized.sameSite = sameSite;
  return normalized;
}

async function saveStorageState(cdp: CdpClient, sessionId: string, statePath: string) {
  const cookieResult = await cdp.send('Storage.getCookies');
  const allCookies = Array.isArray(cookieResult.cookies) ? cookieResult.cookies : [];
  const cookies = allCookies
    .filter((cookie: Record<string, any>) => String(cookie.domain || '').includes('propertyguru'))
    .map(normalizeCookie);

  const localStorage = await evaluate<Array<{ name: string; value: string }>>(cdp, sessionId, `
    (() => Object.entries(localStorage).map(([name, value]) => ({ name, value })))()
  `).catch(() => []);

  if (!cookies.some((cookie: Record<string, any>) => cookie.name === 'PG_U')) {
    throw new Error('PropertyGuru session cookie PG_U was not present after login');
  }

  const state = {
    cookies,
    origins: [{ origin: PROPERTYGURU_ORIGIN, localStorage }],
  };

  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  fs.chmodSync(statePath, 0o600);
  return cookies.length;
}

async function authenticate() {
  const email = requireEnv('PG_EMAIL');
  const password = requireEnv('PG_PASSWORD');
  requireEnv('BROWSER_USE_API_KEY');

  const statePath = path.join(process.cwd(), 'storage', 'pg.state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  let cloudBrowser: BrowserUseBrowser | undefined;
  let cdp: CdpClient | undefined;

  try {
    console.log('☁️  Starting Browser Use Cloud browser for PropertyGuru auth...');
    cloudBrowser = await createCloudBrowser();
    if (cloudBrowser.liveUrl) {
      console.log(`👀 Browser Use live URL: ${cloudBrowser.liveUrl}`);
    }

    const cdpWs = await resolveCdpWs(cloudBrowser.cdpUrl);
    cdp = await CdpClient.connect(cdpWs);
    const sessionId = await createPageSession(cdp);

    await gotoUrl(cdp, sessionId, `${PROPERTYGURU_ORIGIN}/user/login`);
    await waitForPropertyGuruLoginReady(cdp, sessionId);

    await evaluate(cdp, sessionId, `
      (() => {
        const isVisible = (element) => !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
        const accept = Array.from(document.querySelectorAll('button'))
          .find((button) => isVisible(button) && (button.textContent || '').trim() === 'Accept');
        accept?.click();
        return true;
      })()
    `);

    console.log(`📧 Entering PG email (${email.replace(/(.{2}).+(@.*)/, '$1***$2')})...`);
    await setInputValue(cdp, sessionId, 'input[type="email"], input[name="email-fld"], input[placeholder*="Email" i]', email);
    await clickVisibleButton(cdp, sessionId, '^continue$');

    await waitForVisible(cdp, sessionId, 'input[type="password"], input[placeholder*="Password" i]');
    console.log('🔐 Entering PG password...');
    await setInputValue(cdp, sessionId, 'input[type="password"], input[placeholder*="Password" i]', password);
    await clickVisibleButton(cdp, sessionId, '^log in$');
    await Bun.sleep(8_000);

    const loggedIn = await verifyLoggedIn(cdp, sessionId);
    if (!loggedIn) {
      throw new Error('PropertyGuru login verification failed');
    }

    const cookieCount = await saveStorageState(cdp, sessionId, statePath);
    console.log(`✅ PropertyGuru Browser Use Cloud auth saved to ${statePath}`);
    console.log(`🍪 Saved ${cookieCount} cookies`);
  } finally {
    cdp?.close();
    await stopCloudBrowser(cloudBrowser?.id);
  }
}

authenticate().catch((error) => {
  console.error('❌ Browser Use Cloud PropertyGuru auth failed:', error);
  process.exit(1);
});
