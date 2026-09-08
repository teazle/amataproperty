import { describe, expect, test } from "bun:test";

import { POST } from "../src/app/api/sign/submit/route";

describe("public agreement signing", () => {
  test("returns unavailable before it reads a public submission", async () => {
    const request = {
      json() {
        throw new Error("the disabled route must not parse submissions");
      },
    };

    const response = await POST(request as never);

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: "Public agreement signing is unavailable",
    });
  });
});
