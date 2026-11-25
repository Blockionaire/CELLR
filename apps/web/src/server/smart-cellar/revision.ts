import "server-only";

/**
 * The revision named in an If-Match header (sprint 3; compared by the database since 0055): one entity tag, quoted or
 * not, weak or not. Anything else names none. The tag is passed on CHARACTER FOR CHARACTER: a revision is the place's
 * updated_at as PostgREST wrote it, to the microsecond ("2026-11-29T10:00:00.123456+00:00"), and the database reads it
 * back as a time. Nothing here parses it as a date (a JavaScript Date keeps milliseconds only, which would make it
 * another revision). Unit-tested.
 */
export function revisionFromIfMatch(header: string | null): string | null {
  if (!header) return null;
  const tag = header.trim().replace(/^W\//, "");
  const bare = tag.startsWith('"') && tag.endsWith('"') && tag.length >= 2 ? tag.slice(1, -1) : tag;
  return bare.length > 0 && bare.length <= 64 && !bare.includes(",") && bare !== "*" ? bare : null;
}
