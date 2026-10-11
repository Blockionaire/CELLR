"use client";

import { MotionConfig } from "motion/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { ToastProvider } from "./toast";

function makeQueryClient() {
  return new QueryClient({
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
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <ToastProvider>{children}</ToastProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
