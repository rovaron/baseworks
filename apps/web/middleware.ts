import { NextRequest, NextResponse } from "next/server";

/**
 * Edge middleware for dashboard route protection.
 *
 * INTENTIONAL LIMITATION: This only checks cookie presence, not session validity.
 * Edge middleware cannot make database calls to verify session expiry/revocation.
 * A user with an expired or revoked cookie will briefly see the dashboard layout
 * before client-side auth hooks (useSession) detect the invalid session and redirect.
 * All API calls are still protected server-side by better-auth session validation.
 */
export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get("better-auth.session_token");
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
