import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled, expectedToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (token === (await expectedToken())) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Tout sauf la page de login et les fichiers statiques
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
