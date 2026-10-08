import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const path = pathname.startsWith("/share/") ? "/share/[token]" : pathname;

  console.info(JSON.stringify({
    event: "http_request",
    method: request.method,
    path,
  }));

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
