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
    const token = await createAdminSessionToken();

    expect(response.status).toBe(200);
    expect(token).toBeString();
    expect(response.headers.get("set-cookie")).toContain(token!);
    expect(await isValidAdminSession(token)).toBe(true);
  });

  test("rejects the former built-in fallback while configured credentials are present", async () => {
    setConfiguration("configured-admin-password", "configured-session-secret");
    const formerFallback = ["am", "ata", "admin"].join("");

    expect(isAdminPassword(formerFallback)).toBe(false);
    expect((await login(formerFallback)).status).toBe(401);
  });
});
