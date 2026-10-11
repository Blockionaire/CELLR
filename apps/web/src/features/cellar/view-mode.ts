export type CellarViewMode = "grid" | "list";

/** Remembered in a cookie (not local storage) so the server can render the right view on first paint. */
export const CELLAR_VIEW_COOKIE = "cellr-view";

export const parseViewMode = (value: string | undefined): CellarViewMode =>
  value === "list" ? "list" : "grid";
