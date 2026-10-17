"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import {
  ERROR_MESSAGES,
  parseWijnkelderBackup,
  slimWijnkelderBackup,
  type ImportOutcome,
  type ImportReport,
  type ScoreScale,
  type WijnkelderBackup,
} from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { Button, buttonStyles } from "@/ui/button";
import { cn } from "@/ui/cn";
import { FileButton } from "@/ui/file-button";
import { PageHeader } from "@/ui/page-header";
import { Segmented } from "@/ui/segmented";
import { useImportWijnkelder } from "./hooks";

/** The most the server accepts; the browser has already stripped what it does not need. */
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;

type Stage =
  | { name: "pick" }
  | { name: "review"; backup: WijnkelderBackup; file: string; report: ImportReport }
  | { name: "done"; outcome: ImportOutcome };

const SCALES: readonly ScoreScale[] = [5, 10, 100];

/**
 * Moving house in three calm steps: choose the backup file from the old Wijnkelder app, read exactly what
 * would be brought over (and what could not be understood), then confirm. Nothing is written before that.
 */
export function ImportScreen() {
  const t = useTranslations("import");
  const te = useTranslations();
  const run = useImportWijnkelder();
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const message = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);

  async function choose(file: File) {
    setError(null);
    setReading(true);
    try {
      const parsed = parseWijnkelderBackup(await file.text());
      if (!parsed.ok) return setError(t(parsed.error === "not-json" ? "notJson" : "notWijnkelder"));
      const backup = slimWijnkelderBackup(parsed.backup);
      if (JSON.stringify(backup).length > MAX_UPLOAD_BYTES) return setError(t("tooBig"));
      const outcome = await run.mutateAsync({ backup, dryRun: true });
      setStage({ name: "review", backup, file: file.name, report: outcome.report });
    } catch (e) {
      setError(message(e));
    } finally {
      setReading(false);
    }
  }

  async function rescale(scoreScale: ScoreScale) {
    if (stage.name !== "review") return;
    setError(null);
    try {
      const outcome = await run.mutateAsync({ backup: stage.backup, dryRun: true, scoreScale });
      setStage({ ...stage, report: outcome.report });
    } catch (e) {
      setError(message(e));
    }
  }

  async function confirm() {
    if (stage.name !== "review") return;
    setError(null);
    try {
      const outcome = await run.mutateAsync({
        backup: stage.backup,
        dryRun: false,
        ...(stage.report.scoreScale ? { scoreScale: stage.report.scoreScale } : {}),
      });
      setStage({ name: "done", outcome });
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {stage.name === "pick" && (
        <div className="flex flex-col gap-5">
          <ol className="flex flex-col gap-4 rounded-card bg-surface p-5 text-body text-ink-2 shadow-raised ring-1 ring-hairline">
            {(["step1", "step2", "step3"] as const).map((key, i) => (
              <li key={key} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-raised font-display text-title text-accent-fg tnum"
                >
                  {i + 1}
                </span>
                <span className="pt-0.5">{t(key)}</span>
              </li>
            ))}
          </ol>
          <FileButton
            accept=".json,application/json"
            variant="primary"
            size="lg"
            block
            disabled={reading}
            onFile={choose}
          >
            {reading ? t("reading") : t("choose")}
          </FileButton>
          <p className="text-center text-small text-ink-3">{t("privacy")}</p>
          {error && (
            <p role="alert" className="text-center text-small text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      {stage.name === "review" && (
        <Review
          report={stage.report}
          file={stage.file}
          busy={run.isPending}
          error={error}
          onScale={rescale}
          onConfirm={confirm}
          onBack={() => {
            setError(null);
            setStage({ name: "pick" });
          }}
        />
      )}

      {stage.name === "done" && <Done outcome={stage.outcome} />}
    </div>
  );
}

function Review({
  report,
  file,
  busy,
  error,
  onScale,
  onConfirm,
  onBack,
}: {
  report: ImportReport;
  file: string;
  busy: boolean;
  error: string | null;
  onScale: (scale: ScoreScale) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("import");
  const { counts } = report;
  const nothing = counts.bottlesInCellar + counts.bottlesOpened === 0;

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-labelledby="import-found"
        className="rounded-card bg-surface shadow-raised ring-1 ring-hairline p-5"
      >
        <h2
          id="import-found"
          className="text-caption font-medium uppercase tracking-[0.14em] text-bronze"
        >
          {t("found", { file })}
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
          <Count label={t("countBottles")} value={counts.bottlesInCellar} />
          <Count label={t("countWines")} value={counts.wines} />
          <Count label={t("countOpened")} value={counts.bottlesOpened} />
          <Count label={t("countPlaces")} value={counts.units} />
          <Count label={t("countTastings")} value={counts.tastings} />
          <Count label={t("countFavorites")} value={counts.favorites} />
        </dl>
        {counts.unplaced > 0 && (
          <p className="mt-4 text-small text-ink-2">{t("unplaced", { count: counts.unplaced })}</p>
        )}
      </section>

      {report.scoreScale !== null && counts.tastings > 0 && (
        <section className="rounded-card bg-surface shadow-raised ring-1 ring-hairline p-5">
          <p className="mb-3 text-body">{t("scaleQuestion")}</p>
          <Segmented
            label={t("scaleLabel")}
            value={`${report.scoreScale}`}
            onChange={(v) => onScale(Number(v) as ScoreScale)}
            options={SCALES.map((s) => ({ value: `${s}`, label: t("scaleOption", { max: s }) }))}
          />
          <p className="mt-3 text-small text-ink-3">{t("scaleHint")}</p>
        </section>
      )}

      {report.warnings.length > 0 && (
        <Notes title={t("warningsTitle")}>
          {report.warnings.map((w) => (
            <li key={w.code}>{t(`warning.${w.code}`, { count: w.count, example: w.example })}</li>
          ))}
        </Notes>
      )}
      {report.skipped.length > 0 && (
        <Notes title={t("skippedTitle")}>
          {report.skipped.map((s) => (
            <li key={`${s.what}-${s.reason}`}>
              {t(`skipped.${s.what}-${s.reason}`, { example: s.example })}
            </li>
          ))}
        </Notes>
      )}

      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Button size="lg" block onClick={onConfirm} loading={busy} disabled={nothing}>
          {nothing ? t("nothingToBring") : t("confirm")}
        </Button>
        <Button variant="ghost" size="lg" block onClick={onBack} disabled={busy}>
          {t("chooseOther")}
        </Button>
        {!nothing && <p className="text-center text-small text-ink-3">{t("onlyOnce")}</p>}
      </div>
    </div>
  );
}

function Done({ outcome }: { outcome: ImportOutcome }) {
  const t = useTranslations("import");
  const written = outcome.written;
  return (
    <div role="status" className="flex flex-col gap-5">
      <section className="rounded-card bg-surface shadow-raised ring-1 ring-hairline p-6 text-center">
        <h2 className="font-display text-headline">{t("doneTitle")}</h2>
        {written && (
          <p className="mt-2 text-body text-ink-2">
            {t("doneBody", {
              bottles: written.bottles,
              opened: written.opened,
              tastings: written.tastings,
            })}
          </p>
        )}
      </section>
      {written?.tastingsSkipped && (
        <p className="rounded-card bg-raised p-4 ring-1 ring-hairline text-small text-ink-2">
          {t("tastingsSkipped")}
        </p>
      )}
      <Link
        href="/cellar"
        className={buttonStyles({ variant: "primary", size: "lg", block: true })}
      >
        {t("openCellar")}
      </Link>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-small text-ink-2">{label}</dt>
      <dd className={cn("font-display text-headline tnum", value === 0 && "text-ink-3")}>
        {value}
      </dd>
    </div>
  );
}

function Notes({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card bg-surface shadow-raised ring-1 ring-hairline p-5">
      <h2 className="mb-3 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
        {title}
      </h2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-small text-ink-2">{children}</ul>
    </section>
  );
}
