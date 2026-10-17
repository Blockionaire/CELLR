"use client";

import { MotionConfig } from "motion/react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { RegisterServiceWorker } from "./register-sw";
import { ToastProvider } from "./toast";

/**
 * `onChanged` runs after ANY successful change (add a bottle, rate, move…): the server-rendered parts of the
 * pages the browser kept in memory are thrown away, so the next visit to a tab is never out of date.
 */
function makeQueryClient(onChanged: () => void) {
  return new QueryClient({
    mutationCache: new MutationCache({ onSuccess: () => onChanged() }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true, // an installed PWA is "focused" every time it is opened
        retry: (failureCount, error) =>
          failureCount < 2 && (!(error instanceof ApiError) || error.retryable),
      },
    },
  });
}

/** Client-side providers. `reducedMotion="user"` honours prefers-reduced-motion everywhere: transforms drop, fades stay. */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [queryClient] = useState(() => makeQueryClient(() => router.refresh()));
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <ToastProvider>{children}</ToastProvider>
        <RegisterServiceWorker />
      </MotionConfig>
    </QueryClientProvider>
  );
}
