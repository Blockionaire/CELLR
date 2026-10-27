"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Button } from "@/ui/button";
import { useToast } from "@/ui/toast";

interface ContributionView {
  mode: "off" | "opt_out" | "opt_in";
  contribute: boolean | null;
  active: boolean;
}

const useContribution = () =>
  useQuery({
    queryKey: ["catalog-contribution"],
    queryFn: () => api.get<ContributionView>("/catalog-contribution"),
    staleTime: 60_000,
  });

/** On the scan screen, next to "nothing else is shared": said plainly while this person's wines help. */
export function CatalogScanNote() {
  const t = useTranslations("profile.catalog");
  const status = useContribution();
  if (!status.data?.active) return null;
  return <p className="text-center text-caption text-ink-3">{t("scanNote")}</p>;
}

/**
 * "Help improve CELLR's shared wine list": whether the wines this person confirms may count towards the shared
 * catalogue. Only shown when the owner switched catalogue learning on; saying no also takes back what was counted.
 */
export function CatalogSection() {
  const t = useTranslations("profile.catalog");
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useContribution();
  const change = useMutation({
    mutationFn: (contribute: boolean) =>
      api.put<ContributionView>("/catalog-contribution", { contribute }),
    onSuccess: (view) => {
      queryClient.setQueryData(["catalog-contribution"], view);
      toast.show(view.active ? t("switchedOn") : t("switchedOff"));
    },
    onError: () => toast.show(t("failed"), { tone: "error" }),
  });

  const view = status.data;
  if (!view || view.mode === "off") return null;
  return (
    <section
      aria-labelledby="catalog-title"
      data-testid="catalog-contribution"
      className="flex flex-col items-start gap-3 rounded-card bg-surface p-5 shadow-raised ring-1 ring-hairline md:p-6"
    >
      <h2 id="catalog-title" className="mb-1 font-display text-title">
        {t("title")}
      </h2>
      <p className="text-body text-ink-2">{t("body")}</p>
      <p className="text-small text-ink-2">{t("never")}</p>
      <p className="text-small font-medium">{view.active ? t("isOn") : t("isOff")}</p>
      <Button
        size="sm"
        variant="secondary"
        loading={change.isPending}
        onClick={() => change.mutate(!view.active)}
      >
        {view.active ? t("turnOff") : t("turnOn")}
      </Button>
    </section>
  );
}
