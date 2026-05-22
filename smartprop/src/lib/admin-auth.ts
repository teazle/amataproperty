export const ADMIN_SESSION_COOKIE = "viewproperty_admin_session";

const DEFAULT_ADMIN_PASSWORD = "amataadmin";
const SESSION_SALT = "viewproperty-admin-v1";

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
}

function getAdminSecret() {
  return process.env.ADMIN_AUTH_SECRET || getAdminPassword();
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isAdminPassword(password: string) {
  return password === getAdminPassword();
}

export async function createAdminSessionToken() {
  const payload = `${SESSION_SALT}:${getAdminPassword()}:${getAdminSecret()}`;
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

  return token === await createAdminSessionToken();
}
