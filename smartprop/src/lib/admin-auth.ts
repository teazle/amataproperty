export const ADMIN_SESSION_COOKIE = "viewproperty_admin_session";

const SESSION_SALT = "viewproperty-admin-v1";

type AdminAuthConfig = {
  password: string;
  secret: string;
};

function getAdminAuthConfig(): AdminAuthConfig | null {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_AUTH_SECRET;

  if (!password || !secret) {
    return null;
  }

  return { password, secret };
}

export function isAdminAuthConfigured() {
  return getAdminAuthConfig() !== null;
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isAdminPassword(password: string) {
  const config = getAdminAuthConfig();
  return config !== null && password === config.password;
}

export async function createAdminSessionToken() {
  const config = getAdminAuthConfig();
  if (!config) {
    return null;
  }

  const payload = `${SESSION_SALT}:${config.password}:${config.secret}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload)
  );

  return toHex(digest);
}

export async function isValidAdminSession(token?: string | null) {
  if (!token) {
    return false;
  }

  const expectedToken = await createAdminSessionToken();
  return expectedToken !== null && token === expectedToken;
}
