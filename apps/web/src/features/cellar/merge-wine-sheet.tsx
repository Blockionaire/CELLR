"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  ERROR_MESSAGES,
  formatVintage,
  matchesSearch,
  type MergeWineResult,
  type VintageDetail,
  type WineSummary,
} from "@cellr/domain";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Sheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import { useRefreshCellar, useWines } from "./hooks";

/**
 * "This wine is in here twice": pick the one it really is, and everything kept about this one (its bottles,
 * what you said about them, its wish and stars) moves there. It cannot be undone, so it says exactly what
 * will happen before it does.
 */
export function MergeWineSheet({
  open,
  onClose,
  detail,
}: {
  open: boolean;
  onClose: () => void;
  detail: VintageDetail;
}) {
  const t = useTranslations("merge");
  const tc = useTranslations("common");
  const te = useTranslations();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const refresh = useRefreshCellar();
  const wines = useWines();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<WineSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(
    () =>
      (wines.data ?? [])
        .filter((w) => w.id !== detail.wine.id)
        .filter((w) => query.trim() === "" || matchesSearch([w.name, w.producer], query))
        .slice(0, 30),
    [wines.data, detail.wine.id, query],
  );

  const merge = useMutation({
    mutationFn: (into: WineSummary) =>
      api.post<MergeWineResult>(`/wines/${detail.wine.id}/merge`, {
        intoWineId: into.id,
        year: detail.year,
      }),
    onSuccess: async (result) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["wines"] }), refresh()]);
      toast.show(t("done", { count: result.moved }));
      onClose();
      router.replace(`/cellar/${result.vintageId}`);
    },
    onError: (e) => setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES)),
  });

  const bottles = detail.bottles.length + detail.opened.length;
  const close = () => {
    setTarget(null);
    setQuery("");
    setError(null);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t("title")}
      description={detail.wine.name}
      closeLabel={tc("close")}
    >
      {open &&
        (target ? (
          <div className="flex flex-col gap-5">
            <p className="text-body text-ink">
              {t("confirm", {
                count: bottles,
                wine: `${detail.wine.producer} ${detail.wine.name}`,
                target: `${target.producer} ${target.name}`,
              })}
            </p>
            <p className="text-small text-ink-2">{t("permanent")}</p>
            {error && (
              <p role="alert" className="text-small text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Button
                size="lg"
                block
                loading={merge.isPending}
                onClick={() => merge.mutate(target)}
              >
                {t("go", { target: target.name })}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                block
                disabled={merge.isPending}
                onClick={() => setTarget(null)}
              >
                {tc("back")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-body text-ink-2">
              {t("body", { year: formatVintage(detail.year) })}
            </p>
            <Field
              label={t("searchLabel")}
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="flex flex-col gap-2" aria-label={t("candidates")}>
              {candidates.length === 0 && <li className="text-body text-ink-2">{t("none")}</li>}
              {candidates.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => setTarget(w)}
                    className="flex min-h-14 w-full flex-col items-start justify-center rounded-control border border-hairline bg-surface px-4 py-2 text-left"
                  >
                    <span className="text-body text-ink">{w.name}</span>
                    <span className="text-small text-ink-2">{w.producer}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </Sheet>
  );
}
