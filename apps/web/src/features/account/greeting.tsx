"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { cn } from "@/ui/cn";

const subscribe = () => () => {};
const localHour = () => new Date().getHours();
const serverHour = () => null;

type Part = "Morning" | "Afternoon" | "Evening";
export const partOfDay = (hour: number): Part =>
  hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";

/**
 * The greeting follows the visitor's own clock, not the server's (a Dutch evening is mid-afternoon
 * on a US server). Until the local hour is known the line stays invisible instead of flashing wrong.
 */
export function Greeting({ name, className }: { name: string | null; className?: string }) {
  const t = useTranslations("home");
  const hour = useSyncExternalStore(subscribe, localHour, serverHour);
  const part = partOfDay(hour ?? 20);
  const text = name
    ? t(`greeting${part}` as "greetingMorning" | "greetingAfternoon" | "greetingEvening", { name })
    : t(
        `greeting${part}Anon` as
          "greetingMorningAnon" | "greetingAfternoonAnon" | "greetingEveningAnon",
      );
  return (
    <span
      className={cn(
        "transition-opacity duration-300",
        hour === null ? "opacity-0" : "opacity-100",
        className,
      )}
    >
      {text}
    </span>
  );
}
