import { BootSplash } from "@/ui/boot-splash";

/**
 * Opening the app: the launch screen while the first page is prepared on the server (the signed-in check and the
 * household come first, see (app)/layout.tsx). Without it the response waits for all of that and the screen stays
 * blank until then. Inside the app, tabs keep their own quick placeholder ((app)/loading.tsx).
 */
export default function Loading() {
  return <BootSplash />;
}
