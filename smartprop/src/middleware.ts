import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from "@/lib/admin-auth";
import { getPublicOrigin } from "@/lib/public-origin";

const PUBLIC_ADMIN_API_PREFIX = "/api/admin/auth";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/admin") {
    return NextResponse.next();
  }

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
