export const ADMIN_SESSION_COOKIE = "viewproperty_admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const SESSION_VERSION = 1;
const NONCE_BYTES = 32;

type AdminAuthConfig = {
  password: string;
  secret: string;
};

type AdminSessionPayload = {
  version: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function getAdminAuthConfig(): AdminAuthConfig | null {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_AUTH_SECRET;

  if (!password || !secret) return null;
  return { password, secret };
}

export function isAdminAuthConfigured() {
  return getAdminAuthConfig() !== null;
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;

  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return toBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function secureEquals(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function secureStringEquals(left: string, right: string) {
  return secureEquals(new TextEncoder().encode(left), new TextEncoder().encode(right));
}

async function sessionSignature(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(signature);
}

function parseSessionPayload(encodedPayload: string): AdminSessionPayload | null {
  const bytes = fromBase64Url(encodedPayload);
  if (!bytes) return null;

  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const payload = value as Record<string, unknown>;
    if (
      payload.version !== SESSION_VERSION ||
      !Number.isSafeInteger(payload.issuedAt) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      typeof payload.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(payload.nonce)
    ) {
      return null;
    }

    return {
      version: payload.version,
      issuedAt: payload.issuedAt as number,
      expiresAt: payload.expiresAt as number,
      nonce: payload.nonce,
    };
  } catch {
    return null;
  }
}

export function isAdminPassword(password: string) {
  const config = getAdminAuthConfig();
  return config !== null && secureStringEquals(password, config.password);
}

export async function createAdminSessionToken(nowSeconds = Math.floor(Date.now() / 1_000)) {
  const config = getAdminAuthConfig();
  if (!config) return null;

  const nonce = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(nonce);
  const payload: AdminSessionPayload = {
    version: SESSION_VERSION,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + ADMIN_SESSION_MAX_AGE_SECONDS,
    nonce: toBase64Url(nonce),
  };
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sessionSignature(encodedPayload, config.secret);

  return `${encodedPayload}.${signature}`;
}

export async function isValidAdminSession(token?: string | null, nowSeconds = Math.floor(Date.now() / 1_000)) {
  const config = getAdminAuthConfig();
  if (!token || !config) return false;

  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra !== undefined) return false;

  const providedSignature = fromBase64Url(encodedSignature);
  if (!providedSignature) return false;

  const expectedSignature = fromBase64Url(await sessionSignature(encodedPayload, config.secret));
  if (!expectedSignature || !secureEquals(providedSignature, expectedSignature)) return false;

  const payload = parseSessionPayload(encodedPayload);
  if (!payload) return false;

  return payload.issuedAt <= nowSeconds &&
    payload.expiresAt > nowSeconds &&
    payload.expiresAt - payload.issuedAt === ADMIN_SESSION_MAX_AGE_SECONDS;
}
