import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";
import { getPublicEnv, isDevelopment } from "@/lib/public-env";
import { ADMIN_NOT_FOUND_PATH, classifyPath, refuseAdmin } from "@/lib/routes";
import { getAdminAllowlist } from "@/server/env";

/**
 * Runs before every page request:
 *  1. refreshes the Supabase session cookie when it is about to expire,
 *  2. sends signed-out visitors to /sign-in (and signed-in ones away from it),
 *  3. answers /admin with a real 404 for a signed-in person who is not on the admin allowlist,
 *  4. attaches a fresh nonce-based Content-Security-Policy.
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
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub) && data?.claims?.role === "authenticated";
    userId = signedIn ? String(data!.claims.sub) : null;
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

  // The admin pages refuse non-admins themselves, but under the root loading boundary their notFound() comes after a
  // 200 has been streamed. Decide the status here instead: the request is rewritten to a path no route matches, so
  // the answer is the app's ordinary not-found page with a real 404. (Admins still pass every check in the pages.)
  if (!redirectTo && refuseAdmin(pathname, userId, getAdminAllowlist())) {
    // a page is shown the not-found page; anything else (a form post, a server action) gets an empty 404
    const page = request.method === "GET" || request.method === "HEAD";
    const notFound = page
      ? NextResponse.rewrite(new URL(ADMIN_NOT_FOUND_PATH, request.url), {
          request: { headers: requestHeaders },
        })
      : new NextResponse(null, { status: 404 });
    for (const cookie of response.cookies.getAll()) notFound.cookies.set(cookie); // keep a refreshed session
    notFound.headers.set("Content-Security-Policy", csp);
    return notFound;
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
