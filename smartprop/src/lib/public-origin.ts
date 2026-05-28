import type { NextRequest } from "next/server";

function getCloudflareScheme(request: NextRequest) {
  const visitor = request.headers.get("cf-visitor");

  if (!visitor) {
    return null;
  }

  try {
    const parsed = JSON.parse(visitor) as { scheme?: string };
    return parsed.scheme === "https" || parsed.scheme === "http" ? parsed.scheme : null;
  } catch {
    return null;
  }
}

export function getPublicOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");

  if (!host) {
    return request.nextUrl.origin;
  }

  const cfScheme = getCloudflareScheme(request);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const isProductionHost = host === "viewproperty.ai" || host === "www.viewproperty.ai";
  const protocol = cfScheme || (isProductionHost ? "https" : forwardedProto) || request.nextUrl.protocol.replace(":", "");

  return `${protocol}://${host}`;
}
