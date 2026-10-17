import { ViewTransition } from "react";

/** Every page change cross-fades. Reduced motion turns it off (see globals.css). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <ViewTransition>{children}</ViewTransition>;
}
