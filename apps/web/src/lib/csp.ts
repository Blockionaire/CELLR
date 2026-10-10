export interface CspOptions {
  nonce: string;
  isDev: boolean;
  /** Supabase project URL: signed image URLs and direct uploads go to this origin. */
  supabaseUrl: string;
}

/**
 * Strict, nonce-based Content-Security-Policy (per the Next.js CSP guide).
 *  - scripts: only ours + nonce'd, `strict-dynamic` lets trusted scripts load their chunks
 *  - style attributes are allowed inline (React `style={…}` renders them; they cannot execute code)
 *  - the only external origin is our own Supabase project (images, signed uploads)
 */
export function buildCsp({ nonce, isDev, supabaseUrl }: CspOptions): string {
  const supabase = new URL(supabaseUrl).origin;
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data: ${supabase}`,
    `connect-src 'self' ${supabase}`,
    "font-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  // Browsers treat http://localhost specially, but upgrading it still breaks local development.
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
