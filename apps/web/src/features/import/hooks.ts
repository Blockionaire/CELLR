"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ImportOutcome, ImportRequest } from "@cellr/domain";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";

/**
 * Sends a (slimmed) Wijnkelder backup. A dry run only reports; the real thing writes, after which every
 * list that shows the cellar is stale.
 */
export function useImportWijnkelder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Pick<ImportRequest, "backup" | "dryRun" | "scoreScale">) =>
      api.post<ImportOutcome>("/import/wijnkelder", input),
    onSuccess: async (outcome) => {
      if (!outcome.committed) return;
      track("import_completed");
      await queryClient.invalidateQueries();
    },
  });
}
