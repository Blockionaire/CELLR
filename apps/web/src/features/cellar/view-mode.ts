export const CELLAR_VIEWS = ["grid", "list", "racks", "3d"] as const;
export type CellarViewMode = (typeof CELLAR_VIEWS)[number];

/** Remembered in a cookie (not local storage) so the server can render the right view on first paint. */
export const CELLAR_VIEW_COOKIE = "cellr-view";

export const parseViewMode = (value: string | undefined): CellarViewMode =>
  CELLAR_VIEWS.find((v) => v === value) ?? "grid";
