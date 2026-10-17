import type { ReactNode } from "react";
import { BottleGlyph, type BottleShape, type WineTint } from "@/ui/bottle-glyph";
import { cn } from "@/ui/cn";
import { Logo } from "@/ui/logo";

const STAGES: ReadonlyArray<{ shape: BottleShape; tint: WineTint; stage: string; lift: boolean }> =
  [
    { shape: "burgundy", tint: "white", stage: "bg-stage-white", lift: false },
    { shape: "bordeaux", tint: "red", stage: "bg-stage-red", lift: true },
    { shape: "champagne", tint: "rose", stage: "bg-stage-rose", lift: false },
  ];

/** Shared frame for sign-in and onboarding: logo, a row of bottles on tinted stages, then the form. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10 pt-safe pb-safe">
      <div className="flex flex-col items-center text-center">
        <Logo className="h-20 sm:h-24" />
        <div className="mt-7 flex items-end justify-center gap-3" aria-hidden="true">
          {STAGES.map((s, i) => (
            <div
              key={i}
              className={cn(
                "relative flex h-24 w-[4.5rem] items-end justify-center overflow-hidden rounded-[20px] shadow-raised ring-1 ring-hairline",
                s.lift && "h-28 w-20",
                s.stage,
              )}
            >
              <span className="absolute -bottom-8 left-1/2 size-24 -translate-x-1/2 rounded-full bg-surface/45" />
              <BottleGlyph
                shape={s.shape}
                tint={s.tint}
                className={cn("relative mb-1.5", s.lift ? "w-9" : "w-8")}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-9">{children}</div>
    </div>
  );
}

/** Calm serif hero line plus a quiet supporting sentence. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="text-center">
      <h1 className="font-display text-display text-balance">{title}</h1>
      <p className="mx-auto mt-3 max-w-xs text-body text-ink-2 text-balance">{subtitle}</p>
    </div>
  );
}

/** Large pill-shaped input styling for Field / CodeField. */
export const PILL_INPUT = "h-14 rounded-full px-6";
