import "server-only";
import {
  DomainError,
  dueNotices,
  type NoticeWine,
  type PushStatusView,
  type PushSubscriptionInput,
} from "@cellr/domain";
import type { PushEnv } from "@/server/env";
import type { PushRepository } from "./types";

const NOT_READY =
  "Reminders need one more database step before they work. See docs/SETUP.md, “Updating the database”.";

/**
 * Switching "tell me when a wine is at its best" on and off for this phone. Switching it on also marks what is
 * already true as known, so the first reminder is real news and not a pile of old ones.
 */
export function createPushService(deps: {
  repo: PushRepository;
  env: PushEnv | null;
  /** The wines in the person's cellar, with their windows. */
  wines: () => Promise<NoticeWine[]>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  return {
    async status(): Promise<PushStatusView> {
      if (!deps.env) return { enabled: false, publicKey: null };
      const ready = (await deps.repo.known()) !== null;
      return ready
        ? { enabled: true, publicKey: deps.env.publicKey }
        : { enabled: false, publicKey: null };
    },

    async subscribe(input: PushSubscriptionInput): Promise<PushStatusView> {
      if (!deps.env)
        throw new DomainError("NOT_FOUND", "Reminders on the phone are not switched on here.");
      const added = await deps.repo.add(input);
      if (added === null) throw new DomainError("INTERNAL", NOT_READY);
      const known = (await deps.repo.known()) ?? new Set<string>();
      const { quiet } = dueNotices(await deps.wines(), known, now(), true);
      await deps.repo.markKnown(quiet);
      return { enabled: true, publicKey: deps.env.publicKey };
    },

    async unsubscribe(endpoint: string): Promise<{ ok: true }> {
      await deps.repo.remove(endpoint);
      return { ok: true };
    },
  };
}

export type PushService = ReturnType<typeof createPushService>;
