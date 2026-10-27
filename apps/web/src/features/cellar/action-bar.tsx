import Link from "next/link";
import type { ReactNode } from "react";

const ROUND =
  "inline-flex size-12 shrink-0 select-none items-center justify-center gap-2 rounded-full bg-raised text-ink-2 transition-[transform,background-color,color,opacity] duration-200 ease-spring hover:text-ink active:scale-[0.92] disabled:pointer-events-none disabled:opacity-45 lg:h-12 lg:w-auto lg:px-5";

/**
 * A round secondary action beside a bottle's main one (open it): an icon on a phone, icon and word on a wide
 * screen. The same in the 3D showcase and on the wine's page. A link when it goes somewhere.
 */
export function BarButton({
  label,
  onClick,
  href,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const inner = (
    <>
      {children}
      <span className="hidden text-small font-medium lg:inline">{label}</span>
    </>
  );
  if (href)
    return (
      <Link href={href} aria-label={label} className={ROUND}>
        {inner}
      </Link>
    );
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={ROUND}
    >
      {inner}
    </button>
  );
}

export function BarIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** The icons the bar uses in more than one place. */
export const MoveIcon = () => (
  <BarIcon>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </BarIcon>
);
export const PageIcon = () => (
  <BarIcon>
    <path d="M14 4h6v6M20 4l-8 8" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </BarIcon>
);
