"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  ERROR_MESSAGES,
  UpdateProfileSchema,
  type HouseholdMemberView,
  type Me,
} from "@cellr/domain";
import { checkMessage, errorMessage } from "@/lib/api";
import { cn } from "@/ui/cn";
import { Button, buttonStyles } from "@/ui/button";
import { Field } from "@/ui/field";
import { Segmented } from "@/ui/segmented";
import { isLocale, type Locale } from "@/i18n/config";
import { rememberLocale } from "@/i18n/client";
import { ThemeSelector, type ThemePreference } from "@/ui/theme";
import { useToast } from "@/ui/toast";
import { ConfirmSheet } from "./confirm-sheet";
import {
  useCreateInvite,
  useExportData,
  useHousehold,
  useMe,
  useRemoveMember,
  useSignOut,
  useUpdateProfile,
} from "./hooks";
import { DeleteAccountSheet } from "./delete-account-sheet";
import { HouseholdSettings } from "./household-settings";
import { HouseholdSwitcher } from "./household-switcher";
import { InviteSheet } from "./invite-sheet";
import { PinSection } from "./pin-section";
import { RemindersSection } from "./reminders-section";
import { FriendsEntry } from "@/features/friends/entry";

function Section({
  title,
  children,
  tone = "default",
}: {
  title: string;
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <section className="rounded-card bg-surface p-5 shadow-raised ring-1 ring-hairline md:p-6">
      <h2 className={cn("mb-4 font-display text-title", tone === "danger" && "text-danger")}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A round monogram, so a person is more than a line of text. */
function Avatar({ name, size = "lg" }: { name: string; size?: "sm" | "lg" }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-accent font-display text-accent-ink",
        size === "lg" ? "size-14 text-headline" : "size-9 text-title",
      )}
    >
      {initial}
    </span>
  );
}

/** A tiny rendering of a theme: canvas, a card and an action pill, in that theme's own colours. */
function ThemePreview({ scheme }: { scheme: "light" | "dark" }) {
  return (
    <span
      aria-hidden="true"
      style={{ colorScheme: scheme }}
      className="flex h-14 flex-1 flex-col justify-center gap-1.5 rounded-[16px] bg-canvas px-3 ring-1 ring-hairline"
    >
      <span className="h-3 w-3/4 rounded-full bg-surface ring-1 ring-hairline" />
      <span className="h-3 w-1/3 rounded-full bg-accent" />
    </span>
  );
}

export function ProfileView({
  initialMe,
  initialTheme,
}: {
  initialMe: Me;
  initialTheme: ThemePreference;
}) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const te = useTranslations();
  const toast = useToast();
  const queryClient = useQueryClient();
  const activeLocale = useLocale();

  const { data: me = initialMe } = useMe(initialMe);
  const household = useHousehold(me.activeHouseholdId);
  const updateProfile = useUpdateProfile();
  const removeMember = useRemoveMember();
  const invite = useCreateInvite();
  const signOut = useSignOut();
  const exportData = useExportData();

  const [name, setName] = useState(me.displayName ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: "leave" } | { kind: "remove"; member: HouseholdMemberView } | null
  >(null);

  const message = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);
  const active = me.households.find((h) => h.id === me.activeHouseholdId) ?? null;
  const isOwner = active?.role === "owner";
  // Leaving must not strand a household: not as its only member (nobody could get back in), and not as its last
  // owner while others remain (the database refuses that too). Until the members are known, nothing is offered.
  const members = household.data?.members;
  const leaveBlock: "loading" | "alone" | "lastOwner" | null = !members
    ? "loading"
    : members.length <= 1
      ? "alone"
      : isOwner && members.filter((m) => m.role === "owner").length <= 1
        ? "lastOwner"
        : null;
  const nameChanged = name.trim() !== (me.displayName ?? "");

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setNameError(null);
    const parsed = UpdateProfileSchema.safeParse({ displayName: name });
    if (!parsed.success) return setNameError(checkMessage(parsed.error.issues, te));
    try {
      await updateProfile.mutateAsync(parsed.data);
      toast.show(tc("saved"));
    } catch (e) {
      setNameError(message(e));
    }
  }

  async function confirmAction() {
    if (!active || !confirm) return;
    const userId = confirm.kind === "leave" ? me.userId : confirm.member.userId;
    try {
      await removeMember.mutateAsync({ householdId: active.id, userId });
      setConfirm(null);
      // Leaving may leave the person with no household: let the server decide where they belong now.
      // Full reload on purpose: drop every cached page and query that belonged to that household.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (confirm.kind === "leave") window.location.assign("/");
    } catch (e) {
      setConfirm(null);
      toast.show(message(e), { tone: "error" });
    }
  }

  /** The profile keeps the choice (so every device follows); this device switches right away. */
  async function changeLanguage(locale: Locale) {
    try {
      await updateProfile.mutateAsync({ locale });
      rememberLocale(locale);
      try {
        sessionStorage.setItem("cellr-locale-sync", locale);
      } catch {
        // fine without it
      }
      window.location.reload();
    } catch (e) {
      toast.show(message(e), { tone: "error" });
    }
  }

  async function handleSignOut() {
    try {
      await signOut.mutateAsync();
    } finally {
      queryClient.clear();
      // Full reload on purpose: no cached protected page may survive on a shared device.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/sign-in");
    }
  }

  const openInvite = () => {
    setInviteOpen(true);
    if (active) invite.mutate({ householdId: active.id });
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Section title={t("accountSection")}>
        <div className="mb-5 flex items-center gap-4">
          <Avatar name={me.displayName ?? me.email ?? ""} />
          <div className="min-w-0">
            <p className="truncate font-display text-headline">{me.displayName ?? t("unnamed")}</p>
            <p className="truncate text-small text-ink-3">
              <span className="sr-only">{t("emailLabel")}: </span>
              {me.email ?? "—"}
            </p>
          </div>
        </div>
        <form onSubmit={saveName} noValidate className="flex flex-col gap-4">
          <Field
            label={t("nameLabel")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={nameError}
            autoComplete="given-name"
          />
          {nameChanged && (
            <Button type="submit" loading={updateProfile.isPending} className="self-start">
              {tc("save")}
            </Button>
          )}
        </form>
      </Section>

      <FriendsEntry />

      {active && (
        <Section title={t("householdSection")}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-headline text-balance">{active.name}</h3>
            {/* Only an owner can invite (the server says so too): a member would only meet a refusal. */}
            {isOwner && (
              <Button variant="secondary" size="sm" onClick={openInvite} className="shrink-0">
                {t("invite")}
              </Button>
            )}
          </div>
          <p className="mb-1 mt-5 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
            {t("members")}
          </p>
          <ul className="divide-y divide-hairline">
            {(household.data?.members ?? []).map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-3">
                <Avatar name={m.displayName ?? "?"} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body">
                    {m.displayName ?? t("unnamed")}
                    {m.isYou && <span className="ml-2 text-small text-ink-3">({t("you")})</span>}
                  </p>
                  <p className="text-small text-ink-3">
                    {m.role === "owner" ? t("roleOwner") : t("roleMember")}
                  </p>
                </div>
                {isOwner && !m.isYou && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirm({ kind: "remove", member: m })}
                  >
                    {t("remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {leaveBlock === "alone" ? (
            <p className="mt-3 text-small text-ink-3">{t("leaveAlone")}</p>
          ) : leaveBlock === "lastOwner" ? (
            <p className="mt-3 text-small text-ink-3">{t("leaveLastOwner")}</p>
          ) : leaveBlock === null ? (
            <Button
              variant="danger"
              size="sm"
              className="mt-3 -ml-3"
              onClick={() => setConfirm({ kind: "leave" })}
            >
              {t("leave")}
            </Button>
          ) : null}
        </Section>
      )}

      <Section title={t("yourHouseholds")}>
        <HouseholdSwitcher me={me} />
      </Section>

      {active && isOwner && (
        <Section title={t("householdSettings")}>
          {/* Remounted when the household changes, so the fields start from what is saved. */}
          <HouseholdSettings
            key={`${active.id}:${active.name}:${active.currency}`}
            household={active}
          />
        </Section>
      )}

      <Section title={t("dataSection")}>
        <p className="mb-4 text-body text-ink-2">{t("importBody")}</p>
        <Link href="/profile/import" className={buttonStyles({ variant: "secondary", size: "md" })}>
          {t("importLink")}
        </Link>
        <p className="mb-4 mt-6 text-body text-ink-2">{t("exportBody")}</p>
        <Button
          variant="secondary"
          size="md"
          loading={exportData.isPending}
          onClick={() =>
            exportData.mutate(undefined, {
              onError: (e) => toast.show(message(e), { tone: "error" }),
            })
          }
        >
          {exportData.isPending ? t("exporting") : t("exportLink")}
        </Button>
      </Section>

      <PinSection email={me.email} />

      <RemindersSection />

      <Section title={t("appearanceSection")}>
        <p className="mb-2 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
          {t("languageLabel")}
        </p>
        <Segmented<Locale>
          label={t("languageLabel")}
          value={isLocale(activeLocale) ? activeLocale : "en"}
          onChange={changeLanguage}
          options={[
            { value: "en", label: t("languageEnglish") },
            { value: "nl", label: t("languageDutch") },
          ]}
          className="mb-6 self-start"
        />
        <p className="mb-2 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
          {t("themeLabel")}
        </p>
        <div className="mb-3 flex gap-3">
          <ThemePreview scheme="light" />
          <ThemePreview scheme="dark" />
        </div>
        <ThemeSelector
          label={t("themeLabel")}
          initial={initialTheme}
          options={[
            { value: "system", label: t("themeSystem") },
            { value: "light", label: t("themeLight") },
            { value: "dark", label: t("themeDark") },
          ]}
        />
      </Section>

      <Button
        variant="secondary"
        size="lg"
        block
        onClick={handleSignOut}
        loading={signOut.isPending}
      >
        {t("signOut")}
      </Button>
      {me.email && (
        <Section title={t("dangerSection")} tone="danger">
          <Button
            variant="danger"
            size="md"
            className="-ml-4"
            onClick={() => setDeletingAccount(true)}
          >
            {t("deleteAccount")}
          </Button>
          <DeleteAccountSheet
            open={deletingAccount}
            onClose={() => setDeletingAccount(false)}
            email={me.email}
          />
        </Section>
      )}

      {active && (
        <InviteSheet
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          household={active}
          invite={invite}
        />
      )}
      {active && (
        <ConfirmSheet
          open={confirm !== null}
          onClose={() => setConfirm(null)}
          title={confirm?.kind === "remove" ? t("remove") : t("leave")}
          body={
            confirm?.kind === "remove"
              ? t("removeConfirm", { name: confirm.member.displayName ?? t("unnamed") })
              : t("leaveConfirm", { household: active.name })
          }
          confirmLabel={confirm?.kind === "remove" ? t("remove") : t("leave")}
          onConfirm={confirmAction}
          loading={removeMember.isPending}
        />
      )}
    </div>
  );
}
