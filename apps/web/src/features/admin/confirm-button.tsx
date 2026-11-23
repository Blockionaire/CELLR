"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * A submit button for something that cannot be undone (deleting a label, removing a published picture). The first
 * tap only arms it: it then says what a second tap does, and disarms itself after a few seconds. No dialog, so it
 * works the same with a thumb, a mouse and a keyboard, and nothing is removed by one stray tap on a phone.
 */
export function ConfirmButton({
  children,
  confirm,
  className,
  name,
  value,
}: {
  children: ReactNode;
  /** What the armed button says, e.g. "Tap again to remove". */
  confirm: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={className}
      data-armed={armed || undefined}
      onClick={(e) => {
        if (armed) return;
        e.preventDefault();
        setArmed(true);
      }}
      onBlur={() => setArmed(false)}
    >
      <span aria-live="polite">{armed ? confirm : children}</span>
    </button>
  );
}
