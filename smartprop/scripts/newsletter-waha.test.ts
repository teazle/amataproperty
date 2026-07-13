import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { sendCampaignWhatsApp } from '../src/lib/wa/waha';

const originalUrl = process.env.WAHA_URL;
const originalSession = process.env.WAHA_SESSION;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('sendCampaignWhatsApp', () => {
  beforeEach(() => {
    process.env.WAHA_URL = 'http://waha.test:3030';
    process.env.WAHA_SESSION = 'campaign';
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.WAHA_URL;
    else process.env.WAHA_URL = originalUrl;
    if (originalSession === undefined) delete process.env.WAHA_SESSION;
    else process.env.WAHA_SESSION = originalSession;
  });

  test.each([
    ['preflight timeout', () => Promise.reject(new DOMException('timed out', 'AbortError'))],
    ['preflight non-2xx', () => Promise.resolve(jsonResponse({ error: 'down' }, 503))],
    ['preflight non-WORKING status', () => Promise.resolve(jsonResponse({ status: 'SCAN_QR_CODE' }))],
  ])('blocks on %s and never starts the send POST', async (_name, preflight) => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method || 'GET' });
      return preflight();
    }) as typeof fetch;

    const result = await sendCampaignWhatsApp('+6591051399', 'hello', { fetch: fetchImpl });

    expect(result.outcome).toBe('blocked');
    expect(calls).toEqual([
      { url: 'http://waha.test:3030/api/sessions/campaign', method: 'GET' },
    ]);
  });

  test('blocks when the preflight response body stalls and never starts the send POST', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: () => new Promise((resolve) => setTimeout(() => resolve({ status: 'WORKING' }), 25)),
      } as Response;
    }) as typeof fetch;

    const result = await sendCampaignWhatsApp('+6591051399', 'hello', {
      fetch: fetchImpl,
      preflightTimeoutMs: 1,
    });

    expect(result.outcome).toBe('blocked');
    expect(calls).toBe(1);
  });

  test('accepts only a 2xx send response containing a provider id', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) return jsonResponse({ status: 'WORKING' });
      return jsonResponse({ id: 'provider-123' }, 201);
    }) as typeof fetch;

    const result = await sendCampaignWhatsApp('+65 9105 1399', 'hello', { fetch: fetchImpl });

    expect(result).toEqual({ outcome: 'accepted', messageId: 'provider-123' });
    expect(calls[1]?.url).toBe('http://waha.test:3030/api/sendText');
    expect(calls[1]?.init?.method).toBe('POST');
    expect(calls[1]?.init?.redirect).toBe('manual');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      session: 'campaign',
      chatId: '6591051399@c.us',
      text: 'hello',
    });
  });

  test.each([
    [400, false],
    [408, true],
    [429, true],
    [500, true],
  ])('classifies an explicit HTTP %i send rejection (retryable=%s)', async (status, retryable) => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) return jsonResponse({ status: 'WORKING' });
      return jsonResponse({ error: 'provider rejected' }, status);
    }) as typeof fetch;

    expect(await sendCampaignWhatsApp('+6591051399', 'hello', { fetch: fetchImpl })).toEqual({
      outcome: 'rejected',
      retryable,
      error: 'provider rejected',
      statusCode: status,
    });
  });

  test.each([
    ['send reset', () => Promise.reject(new TypeError('connection reset'))],
    ['send timeout', () => Promise.reject(new DOMException('timed out', 'AbortError'))],
    ['unexpected redirect response', () => Promise.resolve(new Response(null, { status: 302 }))],
    ['malformed success JSON', () => Promise.resolve(new Response('{', { status: 200 }))],
    ['success without provider id', () => Promise.resolve(jsonResponse({ success: true }))],
    ['success with blank provider id', () => Promise.resolve(jsonResponse({ id: '   ' }))],
    ['stalled success body', () => Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise((resolve) => setTimeout(() => resolve({ id: 'late-id' }), 25)),
    } as Response)],
  ])('returns unknown after POST begins for %s', async (_name, send) => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) return jsonResponse({ status: 'WORKING' });
      return send();
    }) as typeof fetch;

    const result = await sendCampaignWhatsApp('+6591051399', 'hello', {
      fetch: fetchImpl,
      sendTimeoutMs: 1,
    });

    expect(result.outcome).toBe('unknown');
    expect(call).toBe(2);
  });
});
