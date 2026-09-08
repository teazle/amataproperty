import { expect, test } from "bun:test";
import { NextRequest } from "next/server";

import { config, middleware } from "../src/middleware";

function request(pathname: string) {
  return new NextRequest(`https://viewproperty.ai${pathname}`);
}

test("matches anonymous diagnostic API requests for authentication", () => {
  expect(config.matcher).toContain("/api/:path*");
});

test("rejects an anonymous diagnostic API request", async () => {
  const response = await middleware(request("/api/test-listings"));

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("keeps the load-balancer health check public", async () => {
  const response = await middleware(request("/api/health"));

  expect(response.headers.get("x-middleware-next")).toBe("1");
});

test("keeps signed WhatsApp webhook ingress public", async () => {
  const response = await middleware(request("/api/wa/webhook"));

  expect(response.headers.get("x-middleware-next")).toBe("1");
});
