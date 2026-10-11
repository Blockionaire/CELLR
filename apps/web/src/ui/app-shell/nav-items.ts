import {
  CellarIcon,
  HomeIcon,
  ProfileIcon,
  ScanIcon,
  SommelierIcon,
  type IconProps,
} from "../icons";
import type { ComponentType } from "react";

export interface NavItem {
  key: "home" | "cellar" | "scan" | "sommelier" | "profile";
  href: string;
  Icon: ComponentType<IconProps>;
  /** The visually distinct central action. */
  primary?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "home", href: "/", Icon: HomeIcon },
  { key: "cellar", href: "/cellar", Icon: CellarIcon },
  { key: "scan", href: "/scan", Icon: ScanIcon, primary: true },
  { key: "sommelier", href: "/sommelier", Icon: SommelierIcon },
  { key: "profile", href: "/profile", Icon: ProfileIcon },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}
