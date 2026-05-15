import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isAuthed = !!req.auth;
  const pathname = req.nextUrl.pathname;

  // DEV BYPASS: /play removed from protected list so the AR scene is
  // browsable without sign-in. Restore "/play" before deploying.
  const protectedPaths = ["/account"];
  const needsAuth = protectedPaths.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (needsAuth && !isAuthed) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
