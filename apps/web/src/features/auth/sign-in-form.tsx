"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { ERROR_MESSAGES, OtpCodeSchema, OtpRequestSchema, type PinStatus } from "@cellr/domain";
import { api, ApiError, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { CodeField, Field } from "@/ui/field";
import { useToast } from "@/ui/toast";
import { AuthHeading, AuthShell, PILL_INPUT } from "./auth-shell";
import { rememberSignIn, useSignInMemory } from "./device-memory";
import { PinPad } from "./pin-pad";
import { PinSetup } from "./pin-setup";

const RESEND_SECONDS = 30;

type Step = "email" | "code" | "pin" | "offer" | "setPin";

/**
 * Email → 6-digit code (typed in the app, not a link, so it works from an installed iPhone app). After that,
 * an optional PIN: next time, on this phone or any other, the PIN is enough.
 */
export function SignInForm({ next }: { next: string }) {
  const t = useTranslations("signIn");
  const tp = useTranslations("pin");
  const te = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const memory = useSignInMemory();

  // Until this phone's memory is read, the step is not decided: a remembered PIN opens the PIN screen.
  const [chosen, setChosen] = useState<Step | null>(null);
  const step: Step | null = chosen ?? (memory === undefined ? null : memory?.pin ? "pin" : "email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const address = chosen === null && memory?.pin ? memory.email : email;

  const message = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);

  const request = useMutation({
    mutationFn: (to: string) => api.post("/auth/otp/request", { email: to }),
    meta: { refresh: false },
  });
  const verify = useMutation({
    mutationFn: (input: { email: string; code: string }) =>
      api.post<{ ok: true; pin: PinStatus }>("/auth/otp/verify", input),
    meta: { refresh: false },
  });
  const pinSignIn = useMutation({
    mutationFn: (input: { email: string; pin: string }) => api.post("/auth/pin", input),
    meta: { refresh: false },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const go = (s: Step) => {
    setError(null);
    setChosen(s);
  };
  const enter = () => {
    router.replace(next);
    router.refresh();
  };

  async function sendCode(event?: FormEvent, to = email) {
    event?.preventDefault();
    setError(null);
    const parsed = OtpRequestSchema.safeParse({ email: to });
    if (!parsed.success) return setError(t("invalidEmail"));
    try {
      await request.mutateAsync(parsed.data.email);
      setEmail(parsed.data.email);
      go("code");
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
      const { pin: status } = await verify.mutateAsync({ email, code: parsed.data });
      const noOffer = memory?.email === email && memory.noOffer === true;
      rememberSignIn({ email, pin: status.enabled, noOffer });
      // No PIN yet (and the app can keep one): offer it right here, unless this phone was told "not now".
      if (status.ready && !status.enabled && !noOffer) go("offer");
      else enter();
    } catch (e) {
      setError(message(e));
    }
  }

  async function signInWithPin(value: string) {
    setError(null);
    try {
      await pinSignIn.mutateAsync({ email: address, pin: value });
      rememberSignIn({ email: address, pin: true });
      enter();
    } catch (e) {
      setPin("");
      setAttempt((a) => a + 1);
      setError(e instanceof ApiError && e.code === "PIN_INVALID" ? tp("wrong") : message(e));
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

  if (step === null) return <AuthShell>{null}</AuthShell>;

  return (
    <AuthShell>
      {step === "email" && (
        <form onSubmit={sendCode} noValidate className="flex flex-col gap-6">
          <AuthHeading title={t("title")} subtitle={t("subtitle")} />
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
            inputClassName={PILL_INPUT}
            error={error}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" size="lg" block loading={request.isPending}>
            {t("sendCode")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
            onClick={() => {
              const parsed = OtpRequestSchema.safeParse({ email });
              if (!parsed.success) return setError(t("invalidEmail"));
              setEmail(parsed.data.email);
              setPin("");
              go("pin");
            }}
          >
            {tp("usePin")}
          </Button>
        </form>
      )}

      {step === "code" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verifyCode(code);
          }}
          noValidate
          className="flex flex-col gap-6"
        >
          <AuthHeading title={t("codeTitle")} subtitle={t("codeSubtitle", { email })} />
          <CodeField
            label={t("codeLabel")}
            autoFocus
            placeholder="123456"
            inputClassName={PILL_INPUT}
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
                go("email");
                setCode("");
              }}
            >
              {t("changeEmail")}
            </Button>
          </div>
        </form>
      )}

      {step === "pin" && (
        <div className="flex flex-col gap-6">
          <AuthHeading title={tp("welcomeBack")} subtitle={tp("enterFor", { email: address })} />
          <PinPad
            label={tp("enter")}
            value={pin}
            onChange={(v) => {
              setPin(v);
              if (v.length > 0) setError(null);
            }}
            onComplete={(v) => void signInWithPin(v)}
            error={error}
            attempt={attempt}
            disabled={pinSignIn.isPending}
          />
          <div className="flex flex-col items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              loading={request.isPending}
              onClick={() => {
                setEmail(address);
                void sendCode(undefined, address);
              }}
            >
              {tp("useCode")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                rememberSignIn(null);
                setEmail("");
                go("email");
              }}
            >
              {tp("notYou")}
            </Button>
          </div>
        </div>
      )}

      {step === "offer" && (
        <div className="flex flex-col gap-6" data-testid="pin-offer">
          <AuthHeading title={tp("offerTitle")} subtitle={tp("offerBody")} />
          <Button size="lg" block onClick={() => go("setPin")}>
            {tp("offerYes")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
            onClick={() => {
              rememberSignIn({ email, pin: false, noOffer: true });
              enter();
            }}
          >
            {tp("notNow")}
          </Button>
        </div>
      )}

      {step === "setPin" && (
        <div className="flex flex-col gap-6">
          <AuthHeading title={tp("setTitle")} subtitle={tp("setBody")} />
          <PinSetup
            email={email}
            onDone={() => {
              toast.show(tp("saved"));
              enter();
            }}
            onCancel={enter}
          />
        </div>
      )}
    </AuthShell>
  );
}
