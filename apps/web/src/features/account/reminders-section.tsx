"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { PushStatusView } from "@cellr/domain";
import { api } from "@/lib/api";
import { Button } from "@/ui/button";
import { useToast } from "@/ui/toast";

type Local = "checking" | "unsupported" | "denied" | "on" | "off";

const supported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/** The browser wants the server's public key as bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * "Tell me when a wine is at its best", for this phone. It is per device: a phone and a laptop are switched
 * on separately. Only shown when the server can send reminders at all.
 */
export function RemindersSection() {
  const t = useTranslations("profile.reminders");
  const toast = useToast();
  const status = useQuery({
    queryKey: ["push-status"],
    queryFn: () => api.get<PushStatusView>("/push"),
    staleTime: Infinity,
  });
  const [local, setLocal] = useState<Local>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported()) {
      void Promise.resolve().then(() => setLocal("unsupported"));
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setLocal(sub ? "on" : Notification.permission === "denied" ? "denied" : "off"))
      .catch(() => setLocal("off"));
  }, []);

  if (!status.data?.enabled || !status.data.publicKey) return null;
  const publicKey = status.data.publicKey;

  async function switchOn() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setLocal("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      await api.post("/push", sub.toJSON());
      setLocal("on");
      toast.show(t("switchedOn"));
    } catch {
      toast.show(t("failed"), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function switchOff() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.delete(`/push?endpoint=${encodeURIComponent(sub.endpoint)}`);
        await sub.unsubscribe();
      }
      setLocal("off");
      toast.show(t("switchedOff"));
    } catch {
      toast.show(t("failed"), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    // Same card as the other profile sections; it is only there when reminders can be sent at all.
    <section
      aria-labelledby="reminders-title"
      data-testid="reminders"
      className="flex flex-col items-start gap-3 rounded-card bg-surface p-5 shadow-raised ring-1 ring-hairline md:p-6"
    >
      <h2 id="reminders-title" className="mb-1 font-display text-title">
        {t("title")}
      </h2>
      <p className="text-body text-ink-2">{t("body")}</p>
      {local === "unsupported" && <p className="text-small text-ink">{t("unsupported")}</p>}
      {local === "denied" && <p className="text-small text-ink">{t("denied")}</p>}
      {local === "on" && (
        <>
          <p className="text-small font-medium text-accent-fg">{t("isOn")}</p>
          <Button size="sm" variant="secondary" loading={busy} onClick={switchOff}>
            {t("turnOff")}
          </Button>
        </>
      )}
      {local === "off" && (
        <Button size="sm" loading={busy} onClick={switchOn}>
          {t("turnOn")}
        </Button>
      )}
    </section>
  );
}
