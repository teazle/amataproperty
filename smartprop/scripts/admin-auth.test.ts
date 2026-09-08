import { afterEach, describe, expect, test } from "bun:test";

import {
  createAdminSessionToken,
  isAdminPassword,
  isValidAdminSession,
} from "../src/lib/admin-auth";
import { POST } from "../src/app/api/admin/auth/login/route";

const originalEnvironment = {
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  ADMIN_AUTH_SECRET: process.env.ADMIN_AUTH_SECRET,
  NODE_ENV: process.env.NODE_ENV,
};

function setConfiguration(password?: string, secret?: string) {
  if (password === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = password;

  if (secret === undefined) delete process.env.ADMIN_AUTH_SECRET;
  else process.env.ADMIN_AUTH_SECRET = secret;
}

function login(password: string) {
  return POST(new Request("http://localhost/api/admin/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  }) as never);
}

afterEach(() => {
  setConfiguration(originalEnvironment.ADMIN_PASSWORD, originalEnvironment.ADMIN_AUTH_SECRET);
  if (originalEnvironment.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnvironment.NODE_ENV;
});

describe("admin authentication", () => {
  test("fails closed in production when either required credential is missing", async () => {
    process.env.NODE_ENV = "production";
    for (const [password, secret] of [
      [undefined, undefined],
      ["configured-admin-password", undefined],
      [undefined, "configured-session-secret"],
    ]) {
      setConfiguration(password, secret);

      expect(isAdminPassword("configured-admin-password")).toBe(false);
      expect(await createAdminSessionToken()).toBeNull();
      expect(await isValidAdminSession("any-token")).toBe(false);

      const response = await login("configured-admin-password");
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Admin login is unavailable" });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  test("rejects a wrong password when both required credentials are configured", async () => {
    setConfiguration("configured-admin-password", "configured-session-secret");

    const response = await login("wrong-password");
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("issues and validates a session only for configured credentials", async () => {
    setConfiguration("configured-admin-password", "configured-session-secret");

    const response = await login("configured-admin-password");
    const setCookie = response.headers.get("set-cookie") || "";
    const token = setCookie.match(/viewproperty_admin_session=([^;]+)/)?.[1];

    expect(response.status).toBe(200);
    expect(token).toBeString();
    expect(await isValidAdminSession(token)).toBe(true);
  });

  test("rejects an expired signed session", async () => {
    setConfiguration("configured-admin-password", "configured-session-secret");

    const token = await createAdminSessionToken(1_000_000);

    expect(await isValidAdminSession(token, 1_000_000 + (60 * 60 * 24 * 7) + 1)).toBe(false);
  });

  test("rejects a tampered session", async () => {
    setConfiguration("configured-admin-password", "configured-session-secret");

    const token = await createAdminSessionToken(1_000_000);
    const [payload, signature] = token!.split(".");
    const tamperedSignature = `${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}`;

    expect(await isValidAdminSession(`${payload}.${tamperedSignature}`, 1_000_000)).toBe(false);
  });

  test("rejects a noncanonical Base64url signature encoding", async () => {
    setConfiguration("configured-admin-password", "configured-session-secret");

    const token = await createAdminSessionToken(1_000_000);
    const [payload, signature] = token!.split(".");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const lastCharacter = signature!.at(-1)!;
    const canonicalIndex = alphabet.indexOf(lastCharacter);
    const equivalentNoncanonicalCharacter = alphabet[(canonicalIndex & 0b111100) | 0b000001];

    expect(await isValidAdminSession(`${payload}.${signature!.slice(0, -1)}${equivalentNoncanonicalCharacter}`, 1_000_000)).toBe(false);
  });

  test("issues a fresh session nonce for each successful login", async () => {
    setConfiguration("configured-admin-password", "configured-session-secret");

    const first = await createAdminSessionToken(1_000_000);
    const second = await createAdminSessionToken(1_000_000);

    expect(first).not.toBe(second);
  });

  test("rejects the former built-in fallback while configured credentials are present", async () => {
    setConfiguration("configured-admin-password", "configured-session-secret");
    const formerFallback = ["am", "ata", "admin"].join("");

    expect(isAdminPassword(formerFallback)).toBe(false);
    expect((await login(formerFallback)).status).toBe(401);
  });
});
