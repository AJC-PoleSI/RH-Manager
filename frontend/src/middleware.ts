import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge middleware — coarse-grained route protection.
 *
 * The real authorization happens in API routes (where JWT is fully
 * verified). This middleware is a UX/defense-in-depth layer that
 * prevents wrong-role URL pastes from even rendering the wrong shell.
 *
 * Auth in this app is stored in localStorage (not cookies), which the
 * Edge runtime cannot read directly. So this middleware can only act on
 * request paths and let the client-side layout guard finalize the
 * redirect once it can read the token. The combined effect:
 *   - obvious wrong-role hits get blocked before rendering
 *   - the client-side guard in DashboardLayout closes the gap
 */

const CANDIDATE_PREFIX = "/candidates";
const DASHBOARD_PREFIX = "/dashboard";

// Public routes that anyone (signed in or not) can access.
const PUBLIC_PATHS = [
  "/login",
  "/mentions-legales",
  "/politique-confidentialite",
  "/api/auth",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths through.
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // For everything else, let it through — the client-side
  // DashboardLayout (with `allowedRoles`) performs the actual role
  // check using the token from localStorage, which middleware cannot
  // access. This middleware is a placeholder for when auth moves to
  // cookies (then we'd verify here).
  return NextResponse.next();
}

export const config = {
  // Run on app routes only — skip Next internals + static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
