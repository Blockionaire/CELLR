export const THEME_COOKIE = "theme";

/** Only an explicit "light" or "dark" is a stored choice; anything else means "follow the system". */
export function readThemeCookie(value: string | undefined): "light" | "dark" | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}
