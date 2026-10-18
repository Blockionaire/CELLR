"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ERROR_MESSAGES, type PinStatus } from "@cellr/domain";
import { rememberPin } from "@/features/auth/device-memory";
import { PinSetup } from "@/features/auth/pin-setup";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";

const pinKey = ["pin"] as const;

/** Profile: sign in with a PIN instead of an emailed code — set it, change it, or switch it off. */
export function PinSection({ email }: { email: string | null }) {
  const t = useTranslations("pin");
  const tc = useTranslations("common");
  const te = useTranslations();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const status = useQuery({ queryKey: pinKey, queryFn: () => api.get<PinStatus>("/me/pin") });
  const off = useMutation({
    mutationFn: () => api.delete<PinStatus>("/me/pin"),
    onSuccess: (s) => {
      queryClient.setQueryData(pinKey, s);
      rememberPin(false, email);
      toast.show(t("removed"));
    },
    onError: (e) =>
      toast.show(
        errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      ),
  });

  if (!status.data?.ready) return null;
  const enabled = status.data.enabled;

  return (
    <section
      data-testid="pin"
      className="rounded-card bg-surface p-5 shadow-raised ring-1 ring-hairline md:p-6"
    >
      <h2 className="mb-2 font-display text-title">{t("sectionTitle")}</h2>
      <p className="text-body text-ink-2">{enabled ? t("sectionOn") : t("sectionOff")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant={enabled ? "secondary" : "primary"} onClick={() => setOpen(true)}>
          {enabled ? t("change") : t("offerYes")}
        </Button>
        {enabled && (
          <Button variant="ghost" loading={off.isPending} onClick={() => off.mutate()}>
            {t("turnOff")}
          </Button>
        )}
      </div>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={enabled ? t("change") : t("setTitle")}
        description={t("setBody")}
        closeLabel={tc("close")}
      >
        {open && (
          <div className="pb-4">
            <PinSetup
              email={email}
              onDone={() => {
                queryClient.setQueryData(pinKey, { ready: true, enabled: true });
                setOpen(false);
                toast.show(t("saved"));
              }}
            />
          </div>
        )}
      </Sheet>
    </section>
  );
}
