"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import {
  CreateHouseholdSchema,
  ERROR_MESSAGES,
  JoinHouseholdSchema,
  nextOnboardingStep,
  UpdateProfileSchema,
  type Me,
} from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Segmented } from "@/ui/segmented";
import { Wordmark } from "@/ui/wordmark";
import { useCreateHousehold, useJoinHousehold, useMe, useUpdateProfile } from "./hooks";

type Mode = "create" | "join";

/** Two short steps, then straight to value: a household, then your name. No ten-question form. */
export function OnboardingFlow({ initialMe }: { initialMe: Me }) {
  const t = useTranslations("onboarding");
  const te = useTranslations();
  const router = useRouter();
  const { data: me = initialMe } = useMe(initialMe);
  const step = nextOnboardingStep(me);

  const [mode, setMode] = useState<Mode>("create");
  const [householdName, setHouseholdName] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState(me.displayName ?? "");
  const [error, setError] = useState<string | null>(null);

  const createHousehold = useCreateHousehold();
  const joinHousehold = useJoinHousehold();
  const updateProfile = useUpdateProfile({ firstTime: me.displayName === null });
  const message = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);

  useEffect(() => {
    if (step === "done") {
      router.replace("/");
      router.refresh();
    }
  }, [step, router]);

  async function submitHousehold(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (mode === "create") {
        const parsed = CreateHouseholdSchema.safeParse({ name: householdName });
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
        await createHousehold.mutateAsync(parsed.data);
      } else {
        const parsed = JoinHouseholdSchema.safeParse({ code });
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
        await joinHousehold.mutateAsync(parsed.data);
      }
    } catch (e) {
      setError(message(e));
    }
  }

  async function submitName(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = UpdateProfileSchema.safeParse({ displayName: name });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
    try {
      await updateProfile.mutateAsync(parsed.data);
    } catch (e) {
      setError(message(e));
    }
  }

  const current = step === "household" ? 1 : 2;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-12 pt-safe pb-safe">
      <Wordmark className="mb-12 text-ink-2" />
      <p className="mb-4 text-caption font-medium uppercase tracking-[0.18em] text-bronze">
        {t("stepOf", { current, total: 2 })}
      </p>

      {step === "name" ? (
        <form onSubmit={submitName} noValidate className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-display text-balance">{t("nameTitle")}</h1>
            <p className="mt-3 text-body text-ink-2">{t("nameSubtitle")}</p>
          </div>
          <Field
            label={t("nameLabel")}
            autoFocus
            autoComplete="given-name"
            placeholder={t("namePlaceholder")}
            error={error}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" size="lg" block loading={updateProfile.isPending}>
            {t("finish")}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitHousehold} noValidate className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-display text-balance">{t("householdTitle")}</h1>
            <p className="mt-3 text-body text-ink-2">{t("householdSubtitle")}</p>
          </div>
          <Segmented<Mode>
            label={t("modeLabel")}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            options={[
              { value: "create", label: t("modeCreate") },
              { value: "join", label: t("modeJoin") },
            ]}
            className="self-start"
          />
          {mode === "create" ? (
            <Field
              label={t("householdNameLabel")}
              autoFocus
              placeholder={t("householdNamePlaceholder")}
              error={error}
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
            />
          ) : (
            <Field
              label={t("codeLabel")}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("codePlaceholder")}
              hint={t("codeHint")}
              error={error}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
          <Button
            type="submit"
            size="lg"
            block
            loading={createHousehold.isPending || joinHousehold.isPending}
          >
            {mode === "create" ? t("createHousehold") : t("joinHousehold")}
          </Button>
        </form>
      )}
    </div>
  );
}
