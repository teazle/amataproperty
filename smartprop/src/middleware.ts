import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from "@/lib/admin-auth";

const PUBLIC_ADMIN_API_PREFIX = "/api/admin/auth";

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

function getPublicOrigin(request: NextRequest) {
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

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith(PUBLIC_ADMIN_API_PREFIX)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;

  if (await isValidAdminSession(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", getPublicOrigin(request));
  loginUrl.searchParams.set("next", `${pathname}${search}`);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/agents/:path*",
    "/api/articles/:path*",
    "/api/conversations/:path*",
    "/api/jobs/:path*",
    "/api/linkedin/:path*",
    "/api/listings/:path*",
    "/api/outreach/:path*",
    "/api/scheduler/:path*",
    "/api/scraper/:path*",
    "/api/services/:path*",
    "/api/viewings/:path*",
    "/api/wa/send/:path*",
  ],
};
