"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  attributionLine,
  noEndorsement,
  originLabel,
  safeHttpUrl,
  type Locale,
  type SourceNotice,
  type WineSourcesData,
  type WineSourcesView,
} from "@cellr/domain";
import { api } from "@/lib/api";
import { ChevronRightIcon } from "@/ui/icons";

/**
 * "BRONNEN & BETROUWBAARHEID" (Wine Intelligence WI-05, the `sources_panel` feature): where what is shown about a
 * wine comes from. One folded section low on the page: closed it is one line, opened it sorts everything into at
 * most four groups (identification, characteristics, CELLR's AI analysis, your own data). It shows only sources that
 * were really used: a household's own wine gets no external source, and a source's name appears only where its
 * record was verifiably linked and the source is cleared and shown to people.
 *
 * Links open outside the app, carry no referrer, and nothing of a source is loaded: no logo, no image, no script.
 */

/**
 * How long a credit may be shown from the browser's memory. A source can be switched off at any moment (its rights
 * withdrawn); the server stops crediting it at once, so what matters here is how soon an open page asks again:
 *  - older than `freshMs` when the section is opened, the page is opened again or the window gets the focus: asked
 *    again before it is trusted;
 *  - an open, visible page asks again every `everyMs` by itself.
 * So a withdrawn source's credit can stay on an open page for at most `everyMs`, and is never brought back from
 * memory after `freshMs`. Nothing is stored beyond the page (responses are `no-store`; the service worker never
 * keeps API answers).
 */
export const SOURCES_FRESHNESS = { freshMs: 15_000, everyMs: 60_000 } as const;

/** What the server adds (catalogue check pages, cleared external sources) for one wine; off = nothing is asked. */
export function useWineSources(wineId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["wine-sources", wineId],
    queryFn: () => api.get<WineSourcesData>(`/wines/${wineId}/sources`),
    enabled: enabled && wineId !== null,
    staleTime: SOURCES_FRESHNESS.freshMs,
    gcTime: SOURCES_FRESHNESS.everyMs,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: SOURCES_FRESHNESS.everyMs,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

const localeOf = (locale: string): Locale => (locale === "nl" ? "nl" : "en");

function Outside({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="font-medium text-accent-fg underline underline-offset-4"
    >
      {children}
    </a>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2" data-testid={id}>
      <h3 id={id} className="text-caption font-medium uppercase tracking-[0.12em] text-bronze">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** One external source: the plain credit line, and behind "licence and details" everything its licence asks for. */
export function SourceCredit({ notice }: { notice: SourceNotice }) {
  const t = useTranslations("sources");
  const locale = useLocale();
  const lang = localeOf(locale);
  const licenseUrl = safeHttpUrl(notice.licenseUrl);
  const recordUrl = safeHttpUrl(notice.sourceUrl);
  const date = notice.retrievedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(notice.retrievedAt))
    : null;
  return (
    <div
      className="rounded-card bg-surface px-4 py-3 ring-1 ring-hairline"
      data-testid="source-credit"
      data-provider={notice.providerId}
    >
      <p className="text-small text-ink">{t("alsoListed", { provider: notice.providerName })}</p>
      <p className="text-small text-ink-2">{attributionLine(notice, lang)}</p>
      <details className="group/credit mt-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-small font-medium text-accent-fg [&::-webkit-details-marker]:hidden">
          {t("creditMore")}
          <ChevronRightIcon
            size={16}
            aria-hidden="true"
            className="rotate-90 transition-transform group-open/credit:-rotate-90"
          />
        </summary>
        <dl className="flex flex-col gap-2 pb-1 text-small text-ink-2">
          <div>
            <dt className="font-medium text-ink">{t("license")}</dt>
            <dd>
              {licenseUrl ? <Outside href={licenseUrl}>{notice.license}</Outside> : notice.license}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">{t("record")}</dt>
            <dd>
              {recordUrl ? (
                <Outside href={recordUrl}>{notice.externalId}</Outside>
              ) : (
                notice.externalId
              )}
              {notice.datasetVersion
                ? ` · ${t("dataset", { version: notice.datasetVersion })}`
                : ""}
              {date ? ` · ${t("retrieved", { date })}` : ""}
            </dd>
          </div>
          {notice.modified && (
            <div data-testid="source-modified">
              <dt className="font-medium text-ink">{t("changes")}</dt>
              <dd>{notice.modificationNotice ?? t("changesDefault")}</dd>
            </div>
          )}
          <div>
            <dt className="font-medium text-ink">{t("relation")}</dt>
            <dd>
              {t("notVerifiedBySource")} {noEndorsement(notice.providerName, lang)}
            </dd>
          </div>
          {notice.legalNotice && (
            <div>
              <dt className="font-medium text-ink">{t("legal")}</dt>
              <dd className="whitespace-pre-line">{notice.legalNotice}</dd>
            </div>
          )}
        </dl>
      </details>
    </div>
  );
}

/** Who says this is this wine: CELLR's own catalogue check (with its pages), or the household itself. */
export function SourceIdentity({ identity }: { identity: WineSourcesView["identity"] }) {
  const t = useTranslations("sources");
  const lang = localeOf(useLocale());
  const pages = identity.catalogSources;
  return (
    <div
      className="flex flex-col gap-2"
      data-testid="source-identity"
      data-origin={identity.origin}
    >
      <p className="text-body text-ink">{originLabel(identity.origin, lang)}</p>
      {identity.origin === "user_provided" ? (
        <p className="text-small text-ink-2">{t("ownWine")}</p>
      ) : pages.length > 0 ? (
        <>
          <p className="text-small text-ink-2">{t("checkedWith")}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-ink-2">
            {pages.map((page) => (
              <li key={`${page.name}:${page.url ?? ""}`}>
                {page.url ? <Outside href={page.url}>{page.name}</Outside> : page.name}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-small text-ink-2">{t("checkedNoPages")}</p>
      )}
      {identity.external.map((notice) => (
        <SourceCredit key={`${notice.providerId}:${notice.externalId}`} notice={notice} />
      ))}
    </div>
  );
}

export function SourcesSection({
  view,
  onOpen,
}: {
  view: WineSourcesView;
  /** The section was opened: the moment to ask the server again what may be credited. */
  onOpen?: (() => void) | undefined;
}) {
  const t = useTranslations("sources");
  const tCheck = useTranslations("purchaseCheck");
  const locale = useLocale();
  const lang = localeOf(locale);
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
  const fieldName = (field: WineSourcesView["characteristics"][number]["field"]) =>
    field === "type" ? tCheck("type") : field === "countryCode" ? tCheck("country") : tCheck(field);

  return (
    <details
      className="group/sources border-t border-hairline py-5"
      data-testid="sources"
      onToggle={(event) => {
        if (event.currentTarget.open) onOpen?.();
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block font-display text-headline text-ink">{t("title")}</span>
          <span className="block text-small text-ink-2">{t("hint")}</span>
        </span>
        <ChevronRightIcon
          size={20}
          aria-hidden="true"
          className="shrink-0 rotate-90 text-ink-3 transition-transform duration-300 ease-spring group-open/sources:-rotate-90"
        />
      </summary>
      <div className="mt-4 flex flex-col gap-6">
        <Group id="sources-identity" title={t("identityTitle")}>
          <SourceIdentity identity={view.identity} />
        </Group>

        {view.characteristics.length > 0 && (
          <Group id="sources-characteristics" title={t("characteristicsTitle")}>
            <p className="text-small text-ink-2">
              <span className="text-ink">
                {new Intl.ListFormat(locale, { type: "conjunction" }).format(
                  view.characteristics.map((c) => fieldName(c.field)),
                )}
                :
              </span>{" "}
              {originLabel(view.identity.origin, lang)}
            </p>
          </Group>
        )}

        {view.ai.length > 0 && (
          <Group id="sources-ai" title={t("aiTitle")}>
            <p className="text-small text-ink-2">{t("aiCaveat")}</p>
            <ul className="flex flex-col gap-2 text-small text-ink-2">
              {view.ai.map((line) => (
                <li key={line.kind} data-testid="source-ai" data-kind={line.kind}>
                  <span className="text-ink">{t(`ai.${line.kind}`)}</span>
                  {line.at ? ` · ${day(line.at)}` : ""}
                  {line.kind === "profile" && line.researched === false && (
                    <span className="block">{t("aiNotResearched")}</span>
                  )}
                  {line.pages.length > 0 && (
                    <span className="block">
                      {t("aiPages")}{" "}
                      {line.pages.map((page, i) => (
                        <span key={page.url}>
                          {i > 0 ? ", " : ""}
                          <Outside href={page.url}>{page.name}</Outside>
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Group>
        )}

        {view.yours.length > 0 && (
          <Group id="sources-yours" title={t("yoursTitle")}>
            <p className="text-small text-ink-2">
              {new Intl.ListFormat(locale, { type: "conjunction" }).format(
                view.yours.map((line) => t(`yours.${line.kind}`, { count: line.count })),
              )}
              . {t("yoursPrivate")}
            </p>
          </Group>
        )}
      </div>
    </details>
  );
}
