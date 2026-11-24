import type { SVGProps } from "react";

/** Two people: "shared". Always next to words; never the only sign that a rack is shared. */
export const PeopleIcon = ({ size = 16, ...p }: SVGProps<SVGSVGElement> & { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19c0-3.2 2.7-5.4 6-5.4s6 2.2 6 5.4" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M16.2 13.9c2.9.2 4.8 2.1 4.8 4.6" />
  </svg>
);
