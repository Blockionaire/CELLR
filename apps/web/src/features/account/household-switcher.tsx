"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { CreateHouseholdSchema, ERROR_MESSAGES, JoinHouseholdSchema, type Me } from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Segmented } from "@/ui/segmented";
import { Sheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import { useCreateHousehold, useJoinHousehold, useSetActiveHousehold } from "./hooks";

type Mode = "create" | "join";

/** Every household you belong to, one tap to switch, and a way to start or join another. */
export function HouseholdSwitcher({ me }: { me: Me }) {
  const t = useTranslations("profile");
  const to = useTranslations("onboarding");
  const tc = useTranslations("common");
  const te = useTranslations();
  const toast = useToast();
  const queryClient = useQueryClient();
  const setActive = useSetActiveHousehold();
  const create = useCreateHousehold();
  const join = useJoinHousehold();
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const message = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);

  /** Switch, then reload on purpose: no cached page or query of the other household may survive. */
  async function switchTo(id: string) {
    try {
      await setActive.mutateAsync(id);
      queryClient.clear();
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch (e) {
      toast.show(message(e), { tone: "error" });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      let id: string;
      if (mode === "create") {
        const parsed = CreateHouseholdSchema.safeParse({ name });
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
        id = (await create.mutateAsync(parsed.data)).id;
      } else {
        const parsed = JoinHouseholdSchema.safeParse({ code });
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
        id = (await join.mutateAsync(parsed.data)).id;
      }
      await switchTo(id);
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <>
      {me.households.length > 1 && (
        <ul className="mb-4 divide-y divide-hairline" aria-label={t("yourHouseholds")}>
          {me.households.map((h) => {
            const current = h.id === me.activeHouseholdId;
            return (
              <li key={h.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-body">{h.name}</p>
                  <p className="text-small text-ink-3">
                    {h.role === "owner" ? t("roleOwner") : t("roleMember")} ·{" "}
                    {t("memberCount", { count: h.memberCount })}
                  </p>
                </div>
                {current ? (
                  <span className="text-small font-medium text-accent-fg">{t("current")}</span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={setActive.isPending && setActive.variables === h.id}
                    aria-label={t("switchTo", { household: h.name })}
                    onClick={() => switchTo(h.id)}
                  >
                    {t("switch")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Button variant="secondary" size="md" onClick={() => setAdding(true)}>
        {t("addHousehold")}
      </Button>

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title={t("addHouseholdTitle")}
        closeLabel={tc("close")}
      >
        {adding && (
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            <Segmented<Mode>
              label={to("modeLabel")}
              value={mode}
              onChange={(m) => {
                setMode(m);
                setError(null);
              }}
              options={[
                { value: "create", label: to("modeCreate") },
                { value: "join", label: to("modeJoin") },
              ]}
              className="self-start"
            />
            {mode === "create" ? (
              <Field
                label={to("householdNameLabel")}
                placeholder={to("householdNamePlaceholder")}
                error={error}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            ) : (
              <Field
                label={to("codeLabel")}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={to("codePlaceholder")}
                hint={to("codeHint")}
                error={error}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
            <Button
              type="submit"
              size="lg"
              block
              loading={create.isPending || join.isPending || setActive.isPending}
            >
              {mode === "create" ? to("createHousehold") : to("joinHousehold")}
            </Button>
          </form>
        )}
      </Sheet>
    </>
  );
}
