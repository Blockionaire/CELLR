"use client";

import { useQuery } from "@tanstack/react-query";
import type { JournalView } from "@cellr/domain";
import { api } from "@/lib/api";

/** My tasting journal. Saving or removing a tasting refreshes it (see useRefreshTastings). */
export const journalKey = ["journal"] as const;

export function useJournal(initialData: JournalView) {
  return useQuery({
    queryKey: journalKey,
    queryFn: () => api.get<JournalView>("/tastings/mine"),
    initialData,
    refetchOnMount: "always",
  });
}
