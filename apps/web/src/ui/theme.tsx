"use client";

import { useState } from "react";
import { Segmented, type SegmentedOption } from "./segmented";
import { THEME_COOKIE } from "./theme-cookie";

export type ThemePreference = "system" | "light" | "dark";

/**
 * System by default; an explicit choice is stored in a cookie so the SERVER can render the right
 * theme on first paint (no flash, no inline script to fight the CSP).
 */
export function ThemeSelector({
  label,
  options,
  initial,
}: {
  label: string;
  options: readonly SegmentedOption<ThemePreference>[];
  /** What the server rendered (it read the cookie), so first paint and the control agree. */
  initial: ThemePreference;
}) {
  const [value, setValue] = useState<ThemePreference>(initial);

  const choose = (next: ThemePreference) => {
    setValue(next);
    const root = document.documentElement;
    if (next === "system") {
      delete root.dataset.theme;
      document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
    } else {
      root.dataset.theme = next;
      document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    }
  };

  return <Segmented label={label} options={options} value={value} onChange={choose} />;
}
