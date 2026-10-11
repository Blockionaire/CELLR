"use client";

import { useState, type ReactNode } from "react";
import { BottleGlyph, type BottleShape, type WineTint } from "@/ui/bottle-glyph";
import { BottomNav } from "@/ui/app-shell/bottom-nav";
import { Rail } from "@/ui/app-shell/rail";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { EmptyState } from "@/ui/empty-state";
import { CodeField, Field } from "@/ui/field";
import { Segmented } from "@/ui/segmented";
import { Sheet } from "@/ui/sheet";
import { Skeleton } from "@/ui/skeleton";
import { Stepper } from "@/ui/stepper";
import { ThemeSelector, type ThemePreference } from "@/ui/theme";
import { useToast } from "@/ui/toast";
import { Wordmark } from "@/ui/wordmark";

const SWATCHES = [
  ["canvas", "Page", "bg-canvas"],
  ["surface", "Cards", "bg-surface"],
  ["raised", "Raised / controls", "bg-raised"],
  ["ink", "Text", "bg-ink"],
  ["ink-2", "Secondary text", "bg-ink-2"],
  ["ink-3", "Tertiary text", "bg-ink-3"],
  ["accent", "Burgundy fill", "bg-accent"],
  ["accent-fg", "Burgundy on dark (lines)", "bg-accent-fg"],
  ["bronze", "Bronze (rare)", "bg-bronze"],
  ["danger", "Error text", "bg-danger"],
] as const;

const TINTS: WineTint[] = ["red", "white", "rose", "sparkling", "orange", "dessert", "fortified"];
const SHAPES: BottleShape[] = ["bordeaux", "burgundy", "champagne"];

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="border-t border-hairline py-8">
      <h2 className="font-display text-headline">{title}</h2>
      {note && <p className="mt-1 max-w-prose text-small text-ink-2">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function Gallery({ initialTheme }: { initialTheme: ThemePreference }) {
  const toast = useToast();
  const [view, setView] = useState<"grid" | "list" | "3d">("grid");
  const [count, setCount] = useState(3);
  const [sheet, setSheet] = useState(false);
  const [chips, setChips] = useState<string[]>(["Fruity"]);

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24 pt-10">
      <div className="flex items-center justify-between">
        <Wordmark />
        <ThemeSelector
          label="Theme"
          initial={initialTheme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
      <h1 className="mt-10 font-display text-display">Design system</h1>
      <p className="mt-3 max-w-prose text-body text-ink-2">
        Calm, tactile, editorial. Few colours; the label and the bottle do the visual work.
      </p>

      <Block
        title="Colour"
        note="Dark is the primary identity; ivory is the same tokens under light-dark()."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SWATCHES.map(([name, role, cls]) => (
            <div key={name} className="overflow-hidden rounded-card border border-hairline">
              <div className={`h-16 ${cls}`} />
              <div className="bg-surface p-2.5">
                <p className="text-small font-medium">{name}</p>
                <p className="text-caption text-ink-3">{role}</p>
              </div>
            </div>
          ))}
        </div>
      </Block>

      <Block
        title="Type"
        note="Geist for the interface. Instrument Serif for wine names, headlines and big numbers."
      >
        <p className="font-display text-display">Marqués de Riscal</p>
        <p className="mt-1 font-display text-headline italic text-ink-2">Reserva 2020 · Rioja</p>
        <p className="mt-4 text-title">Drink now — peak 2026–2029</p>
        <p className="mt-1 text-body">Body text is 16/24, readable on a phone in a dim room.</p>
        <p className="mt-1 text-small text-ink-2">Small text, 14/20 — secondary information.</p>
        <p className="mt-1 text-caption uppercase tracking-[0.18em] text-bronze">
          Caption · eyebrow
        </p>
        <p className="mt-2 font-display text-display tnum">€ 1,234.50 · 2019</p>
      </Block>

      <Block
        title="Buttons"
        note="48px tall (one-hand), 8px radius, press feedback. Primary is the one action per screen."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button>Open bottle</Button>
          <Button variant="secondary">Details</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="danger">Remove</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
        </div>
        <Button size="lg" block className="mt-3">
          Scan a bottle
        </Button>
      </Block>

      <Block title="Fields" note="Labels are always real. Errors are human and announced.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Household name"
            placeholder="Joost & Merel"
            hint="You can rename it later."
          />
          <Field label="Email" defaultValue="nope" error="Enter a valid email address." />
          <CodeField label="6-digit code" placeholder="123456" defaultValue="482 913" />
        </div>
      </Block>

      <Block title="Choices">
        <div className="flex flex-col items-start gap-5">
          <Segmented
            label="Cellar view"
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: "Grid" },
              { value: "list", label: "List" },
              { value: "3d", label: "3D" },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            {["Fruity", "Smooth", "Powerful", "Fresh", "Dry", "Oaky"].map((c) => (
              <Chip
                key={c}
                selected={chips.includes(c)}
                onClick={() =>
                  setChips((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))
                }
              >
                {c}
              </Chip>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-small text-ink-2">How many?</span>
            <Stepper label="Number of bottles" value={count} onChange={setCount} />
          </div>
        </div>
      </Block>

      <Block
        title="Overlays"
        note="Sheets are the native <dialog>: focus trap, Escape, drag to dismiss. Toasts stay above sheets."
      >
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setSheet(true)}>
            Open a sheet
          </Button>
          <Button variant="secondary" onClick={() => toast.show("Saved")}>
            Toast
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.show("We couldn't identify this bottle yet.", { tone: "error" })}
          >
            Error toast
          </Button>
        </div>
        <Sheet
          open={sheet}
          onClose={() => setSheet(false)}
          title="Rate this wine"
          description="How was it?"
        >
          <div className="flex flex-wrap gap-2 py-3">
            {["Fruity", "Smooth", "Powerful"].map((c) => (
              <Chip key={c}>{c}</Chip>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="secondary" size="lg" block onClick={() => toast.show("Copied")}>
              Toast from inside the sheet
            </Button>
            <Button size="lg" block onClick={() => setSheet(false)}>
              Done
            </Button>
          </div>
        </Sheet>
      </Block>

      <Block
        title="Bottles"
        note="Reusable silhouettes: the placeholder wherever there is no photo, and the 3D view's fallback."
      >
        <div className="flex flex-wrap items-end gap-6">
          {SHAPES.map((s) => (
            <figure key={s} className="flex w-16 flex-col items-center gap-2">
              <BottleGlyph shape={s} tint="red" />
              <figcaption className="text-caption text-ink-3">{s}</figcaption>
            </figure>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-end gap-4">
          {TINTS.map((t) => (
            <figure key={t} className="flex w-10 flex-col items-center gap-2">
              <BottleGlyph shape="bordeaux" tint={t} />
              <figcaption className="text-caption text-ink-3">{t}</figcaption>
            </figure>
          ))}
        </div>
      </Block>

      <Block title="Loading and empty">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-card border border-hairline bg-surface p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-2 h-4 w-1/3" />
            <Skeleton className="mt-4 h-9 w-24" />
          </div>
          <div className="rounded-card border border-hairline bg-surface">
            <EmptyState
              illustration={false}
              title="No bottles match."
              body="Try fewer filters."
              className="py-8"
            />
          </div>
        </div>
        <div className="mt-3 rounded-card border border-hairline bg-surface">
          <EmptyState
            title="Your cellar starts here."
            body="Scan a bottle and it appears here, beautifully."
            action={<Button size="lg">Scan your first bottle</Button>}
          />
        </div>
      </Block>

      <Block
        title="Navigation"
        note="Phone: bottom bar with a raised Scan. Desktop: a quiet left rail."
      >
        <div className="relative h-36 overflow-hidden rounded-card border border-hairline [transform:translateZ(0)] sm:max-w-sm">
          <BottomNav className="lg:block" />
        </div>
        <div className="relative mt-4 hidden h-[26rem] overflow-hidden rounded-card border border-hairline [transform:translateZ(0)] lg:block">
          <Rail className="lg:flex" />
        </div>
      </Block>
    </div>
  );
}
