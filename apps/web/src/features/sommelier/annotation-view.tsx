"use client";

import { useTranslations } from "next-intl";
import type { BottleAnnotation } from "@cellr/domain";
import { annotationLines, type AnnotationEmphasis } from "./annotation-lines";

/**
 * The app's own facts under one of the sommelier's cards: one or two short lines, quiet next to the card. The first
 * line is what the question was about (how to serve it, how long it keeps); nothing moves, so there is no motion
 * to reduce. Long place names wrap instead of pushing the chat sideways on a small phone.
 */
export function AnnotationView({
  annotation,
  emphasis,
}: {
  annotation: BottleAnnotation;
  emphasis: AnnotationEmphasis;
}) {
  const t = useTranslations("sommelier");
  const lines = annotationLines(annotation, emphasis, t);
  if (lines.length === 0) return null;
  return (
    <div
      className="min-w-0 text-small text-ink-2 break-words"
      data-testid="annotation"
      data-emphasis={emphasis ?? "none"}
    >
      <span className="sr-only">{t("annotate.label")}: </span>
      {lines.map((line, n) => (
        <p key={n} className={n === 0 ? "text-ink-2" : "text-ink-3"}>
          {line}
        </p>
      ))}
    </div>
  );
}
