import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";
import { getPublicEnv, isDevelopment } from "@/lib/public-env";
import { classifyPath } from "@/lib/routes";

/**
 * Runs before every page request:
 *  1. refreshes the Supabase session cookie when it is about to expire,
 *  2. sends signed-out visitors to /sign-in (and signed-in ones away from it),
 *  3. attaches a fresh nonce-based Content-Security-Policy.
 * (Pages also check the session themselves — the proxy is a first layer, not the only one.)
 */
export async function proxy(request: NextRequest) {
  const env = getPublicEnv();
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({ nonce, isDev: isDevelopment(), supabaseUrl: env.supabaseUrl });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // getClaims() validates the token and refreshes it if needed (writing cookies through setAll).
  // It can throw on a corrupt cookie; that must read as "signed out", never take the whole site down.
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub) && data?.claims?.role === "authenticated";
  } catch {
    signedIn = false;
  }

  const { pathname, search } = request.nextUrl;
  const kind = classifyPath(pathname);
  let redirectTo: URL | null = null;
  if (kind === "protected" && !signedIn) {
    redirectTo = new URL("/sign-in", request.url);
    if (pathname !== "/") redirectTo.searchParams.set("next", pathname + search);
  } else if (kind === "auth-only" && signedIn) {
    redirectTo = new URL("/", request.url);
  }

  if (redirectTo) {
    const redirect = NextResponse.redirect(redirectTo);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie); // keep a refreshed session
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Everything except API routes (they authenticate themselves), build assets, PWA files, the public logo and the
  // on-device OCR files (static; they carry their own worker policy, see next.config.ts).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|offline.html|icons/|brand/|splash/|ocr/).*)",
  ],
};
