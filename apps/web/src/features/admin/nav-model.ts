/**
 * The admin portal's structure, in one place: the desktop sidebar, the phone header and the phone tab bar all read
 * it. Pure (no React), so the rules — which page is current, what its title is, where "back" goes — are unit-tested.
 * Links only: nothing here reads admin data, so the navigation is safe to render before any page has loaded.
 */
export type AdminNavItem = { readonly href: string; readonly label: string };
export type AdminNavGroup = {
  /** null: the group has one page and no heading (Overview). */
  readonly label: string | null;
  /** The phone tab bar's short name and key. */
  readonly tab: AdminTab;
  readonly items: ReadonlyArray<AdminNavItem>;
};
export type AdminTab = "overview" | "wine" | "insights" | "system";

export const ADMIN_NAV: ReadonlyArray<AdminNavGroup> = [
  { label: null, tab: "overview", items: [{ href: "/admin", label: "Overview" }] },
  {
    label: "Wine management",
    tab: "wine",
    items: [
      { href: "/admin/wines", label: "Wine Master Database" },
      { href: "/admin/bottle-photos", label: "Bottle photos" },
      { href: "/admin/catalog", label: "Wine catalogue" },
      { href: "/admin/catalog/corrections", label: "Corrections" },
      { href: "/admin/sources", label: "External sources" },
    ],
  },
  {
    label: "Insights",
    tab: "insights",
    items: [
      { href: "/admin/users", label: "Users" },
      { href: "/admin/product", label: "Product analytics" },
      { href: "/admin/ai", label: "AI & costs" },
      { href: "/admin/feedback", label: "Beta feedback" },
    ],
  },
  {
    label: "System",
    tab: "system",
    items: [
      { href: "/admin/system", label: "Architecture" },
      { href: "/admin/system/health", label: "Health" },
    ],
  },
];

export const TAB_LABEL: Readonly<Record<AdminTab, string>> = {
  overview: "Overview",
  wine: "Wine",
  insights: "Insights",
  system: "System",
};

/** The current page's own link: the longest one that the path starts with. */
export function activeHref(
  pathname: string,
  groups: ReadonlyArray<{ items: ReadonlyArray<AdminNavItem> }>,
) {
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  return (
    hrefs
      .filter((h) => pathname === h || (h !== "/admin" && pathname.startsWith(`${h}/`)))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}

/** A detail page's name, by the list it belongs to. */
const DETAIL_TITLE: Readonly<Record<string, string>> = {
  "/admin/wines": "Wine",
  "/admin/bottle-photos": "Bottle photo",
  "/admin/catalog": "Catalogue candidate",
  "/admin/catalog/corrections": "Wine corrections",
  "/admin/users": "User",
};

export interface AdminPageInfo {
  /** The page's title for the phone header. */
  readonly title: string;
  /** The tab bar's group, or null outside the admin's known pages. */
  readonly tab: AdminTab | null;
  /** The group's heading ("Wine management"), shown above a list page's title. */
  readonly group: string | null;
  /** Where "back" goes: the list a detail page belongs to; null on a page of the navigation itself. */
  readonly back: { readonly href: string; readonly label: string } | null;
  /** The navigation entry that is current (aria-current). */
  readonly current: string | null;
}

/**
 * What the phone header shows for a path. `backQuery` is the list's own query string a detail page was opened with
 * (the Wine Master Database passes `?back=`), so "back" returns to the same filtered, sorted page.
 */
export function pageInfo(
  pathname: string,
  backQuery: string | null = null,
  groups: ReadonlyArray<AdminNavGroup> = ADMIN_NAV,
): AdminPageInfo {
  const path = pathname.replace(/\/+$/, "") || "/";
  const current = activeHref(path, groups);
  const group = groups.find((g) => g.items.some((i) => i.href === current)) ?? null;
  const item = group?.items.find((i) => i.href === current) ?? null;
  if (!current || !item)
    return { title: "Admin", tab: null, group: null, back: null, current: null };
  if (path === current)
    return { title: item.label, tab: group!.tab, group: group!.label, back: null, current };
  // re-serialised: whatever came in, only a query string can come out (never a path or another origin)
  const query = backQuery ? new URLSearchParams(backQuery).toString() : "";
  return {
    title: DETAIL_TITLE[current] ?? item.label,
    tab: group!.tab,
    group: group!.label,
    back: { href: query ? `${current}?${query}` : current, label: item.label },
    current,
  };
}
