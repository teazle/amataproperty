import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from "@/lib/admin-auth";
import { getPublicOrigin } from "@/lib/public-origin";

const PUBLIC_API_PATHS = new Set([
  "/api/admin/auth/login",
  "/api/admin/auth/logout",
  "/api/health",
  "/api/public/leads",
  "/api/sign/submit",
  "/api/wa/openclaw",
  "/api/wa/webhook",
]);

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/admin") {
    return NextResponse.next();
  }

  if (PUBLIC_API_PATHS.has(pathname)) {
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
    "/api/:path*",
  ],
};
