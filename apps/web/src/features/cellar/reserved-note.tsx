"use client";

import { useTranslations } from "next-intl";
import type { Reservation } from "@cellr/domain";
import { cn } from "@/ui/cn";
import { useDay } from "./bottle-bits";

/** "Kept for Christmas dinner · 25 Dec": a wine whose bottles (some or all) are spoken for. */
export function ReservedNote({
  reserved,
  count,
  className,
}: {
  reserved: Reservation | null | undefined;
  /** How many bottles of the wine there are in all. */
  count: number;
  className?: string;
}) {
  const t = useTranslations("reserved");
  const day = useDay();
  if (!reserved) return null;
  const when = reserved.on ? day(reserved.on) : null;
  const all = reserved.count >= count;
  const key = `${all ? "all" : "some"}${when ? "Dated" : ""}` as
    "all" | "allDated" | "some" | "someDated";
  const text = t(key, {
    reserved: reserved.count,
    total: count,
    title: reserved.title,
    when: when ?? "",
  });
  return (
    <p
      className={cn("text-small font-medium text-accent-fg", className)}
      data-testid="reserved-note"
    >
      {text}
    </p>
  );
}
