import type { ReactNode } from "react";
import type { PersonCard } from "@cellr/domain";
import { cn } from "@/ui/cn";
import { CheckIcon } from "@/ui/icons";

/** What to call someone: the name they gave, else their account name, else their friend code. */
export const personName = (p: Pick<PersonCard, "displayName" | "handle" | "friendCode">) =>
  p.displayName?.trim() || (p.handle ? `@${p.handle}` : p.friendCode);

/** A round monogram in a colour of its own, so a list of friends is not a list of identical dots. */
export function PersonAvatar({
  person,
  size = "md",
}: {
  person: Pick<PersonCard, "displayName" | "handle" | "friendCode">;
  size?: "md" | "lg";
}) {
  const name = personName(person).replace(/^@/, "");
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  let hash = 0;
  for (const ch of person.friendCode) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-display",
        size === "lg" ? "size-20 text-display" : "size-11 text-title",
      )}
      style={{
        background: `light-dark(oklch(0.9 0.05 ${hash}), oklch(0.36 0.07 ${hash}))`,
        color: `light-dark(oklch(0.38 0.09 ${hash}), oklch(0.92 0.05 ${hash}))`,
      }}
    >
      {initial}
    </span>
  );
}

/** One person in a list: avatar, name, @handle, and whatever can be done with them on the right. */
export function PersonRow({
  person,
  detail,
  actions,
}: {
  person: PersonCard;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  const name = personName(person);
  return (
    <div className="flex items-center gap-3">
      <PersonAvatar person={person} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-ink">{name}</p>
        <p className="truncate text-small text-ink-3">
          {person.handle && name !== `@${person.handle}` ? `@${person.handle}` : null}
          {person.handle && name !== `@${person.handle}` && detail ? " · " : null}
          {detail}
        </p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  children,
  testId,
  aside,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
  aside?: ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="rounded-card bg-surface p-5 shadow-raised ring-1 ring-hairline md:p-6"
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A friend to tick: avatar, name, and a round check on the right. A real checkbox underneath. */
export function FriendCheck({
  friend,
  checked,
  onChange,
}: {
  friend: PersonCard;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-[16px] px-2 py-2 transition-colors hover:bg-raised",
        checked && "bg-raised",
      )}
    >
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={onChange} />
      <PersonAvatar person={friend} />
      <span className="min-w-0 flex-1 truncate text-body text-ink">{personName(friend)}</span>
      <span
        aria-hidden="true"
        className={cn(
          "grid size-6 place-items-center rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent-fg/40",
          checked ? "border-transparent bg-accent text-accent-ink" : "border-ink-3/60",
        )}
      >
        {checked && <CheckIcon size={14} />}
      </span>
    </label>
  );
}
