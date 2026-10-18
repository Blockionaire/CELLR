import { ViewTransition } from "react";

/**
 * Going to another page cross-fades. Only that: the quiet refresh after every change (see Providers) must not
 * animate, or a field someone is typing in could lose what was just typed while the old picture is shown.
 * Reduced motion turns it off (see globals.css).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="auto" exit="auto" update="none" default="none">
      {children}
    </ViewTransition>
  );
}
