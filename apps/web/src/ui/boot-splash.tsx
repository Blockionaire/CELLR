import { useTranslations } from "next-intl";
import { cn } from "./cn";
import { Logo } from "./logo";

/**
 * The launch screen: the CELLR glass and lettering in ivory on the deep-wine dark, a soft glow behind it, and once
 * it takes a moment a thin champagne line with a light passing along it, then "Preparing your cellar". No progress
 * is claimed. It is the same picture as the iPhone's own launch image (public/splash, `pnpm splash`), so opening
 * the home-screen app goes from that image to this one to the app without a jump.
 *
 * - `boot`: shown while the first page is prepared on the server (app/loading.tsx). In a browser tab it fades in
 *   only after a short wait, so a fast load never flashes it; in the home-screen app it is there at once.
 * - `handoff`: drawn over the app as it first appears, in the home-screen app only, and fades away — so the launch
 *   screen dissolves into the app instead of cutting to it. It never takes a tap and is gone after half a second.
 *
 * Fixed dark in both themes, like the home-screen app's splash colour (manifest `background_color`).
 */
export function BootSplash({ mode = "boot" }: { mode?: "boot" | "handoff" }) {
  const t = useTranslations("boot");
  const handoff = mode === "handoff";
  return (
    <div
      role={handoff ? undefined : "status"}
      aria-hidden={handoff || undefined}
      data-testid={handoff ? "boot-handoff" : "boot-splash"}
      className={cn("boot-splash", handoff && "boot-handoff")}
    >
      {!handoff && <span className="sr-only">{t("label")}</span>}
      <span aria-hidden="true" className="boot-glow" />
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-[calc(50%+1rem)]"
      >
        <Logo className="h-[7.5rem] text-hero-ink" />
      </span>
      {!handoff && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-[calc(50%+4.5rem)] flex flex-col items-center gap-4"
        >
          <span className="boot-line" />
          <span className="boot-text text-[0.6875rem] font-medium uppercase leading-4 tracking-[0.26em]">
            {t("preparing")}
          </span>
        </span>
      )}
    </div>
  );
}
