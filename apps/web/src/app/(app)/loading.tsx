import { Skeleton } from "@/ui/skeleton";

/**
 * Shown the instant a tab is tapped, while the next page is prepared on the server: the frame (title, cards)
 * is there at once and the content fills in. Also what makes the tabs prefetch: the shell is ready before the tap.
 */
export default function Loading() {
  return (
    <div className="pt-10 lg:pt-14" role="status" aria-busy="true">
      <Skeleton className="h-11 w-1/2 rounded-full" />
      <Skeleton className="mt-3 h-4 w-2/3 rounded-full" />
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-60 rounded-card" />
        ))}
      </div>
    </div>
  );
}
