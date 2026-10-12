"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { ERROR_MESSAGES, OtpCodeSchema, OtpRequestSchema } from "@cellr/domain";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { CodeField, Field } from "@/ui/field";
import { useToast } from "@/ui/toast";
import { Logo } from "@/ui/logo";

const RESEND_SECONDS = 30;

/** Email → 6-digit code. The code is typed in the app (not a link), so it works from an installed iPhone app. */
export function SignInForm({ next }: { next: string }) {
  const t = useTranslations("signIn");
  const te = useTranslations();
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const message = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);

  const request = useMutation({
    mutationFn: (address: string) => api.post("/auth/otp/request", { email: address }),
  });
  const verify = useMutation({
    mutationFn: (input: { email: string; code: string }) => api.post("/auth/otp/verify", input),
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    const parsed = OtpRequestSchema.safeParse({ email });
    if (!parsed.success) return setError(t("invalidEmail"));
    try {
      await request.mutateAsync(parsed.data.email);
      setEmail(parsed.data.email);
      setStep("code");
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      setError(message(e));
    }
  }

  async function verifyCode(raw: string) {
    setError(null);
    const parsed = OtpCodeSchema.safeParse(raw);
    if (!parsed.success) return;
    try {
      await verify.mutateAsync({ email, code: parsed.data });
      router.replace(next);
      router.refresh();
    } catch (e) {
      setError(message(e));
    }
  }

  async function resend() {
    setError(null);
    try {
      await request.mutateAsync(email);
      setCooldown(RESEND_SECONDS);
      toast.show(t("resent"));
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-12 pt-safe pb-safe">
      <Logo className="mb-10 h-28" />

      {step === "email" ? (
        <form onSubmit={sendCode} noValidate className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-display text-balance">{t("title")}</h1>
            <p className="mt-3 text-body text-ink-2">{t("subtitle")}</p>
          </div>
          <Field
            label={t("emailLabel")}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            placeholder={t("emailPlaceholder")}
            hint={t("emailHint")}
            error={error}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" size="lg" block loading={request.isPending}>
            {t("sendCode")}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verifyCode(code);
          }}
          noValidate
          className="flex flex-col gap-6"
        >
          <div>
            <h1 className="font-display text-display text-balance">{t("codeTitle")}</h1>
            <p className="mt-3 text-body text-ink-2">{t("codeSubtitle", { email })}</p>
          </div>
          <CodeField
            label={t("codeLabel")}
            autoFocus
            placeholder="123456"
            error={error}
            value={code}
            onChange={(e) => {
              const value = e.target.value;
              setCode(value);
              if (/^\d{6}$/.test(value.replace(/[\s-]+/g, ""))) void verifyCode(value);
            }}
          />
          <Button type="submit" size="lg" block loading={verify.isPending}>
            {t("verify")}
          </Button>
          <div className="flex flex-col items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={resend}
              disabled={cooldown > 0 || request.isPending}
            >
              {cooldown > 0 ? t("resendIn", { seconds: cooldown }) : t("resend")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              {t("changeEmail")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
