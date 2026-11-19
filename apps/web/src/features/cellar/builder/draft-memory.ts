import type { BuilderDraft } from "./draft";

/**
 * Unsaved drafts, kept for the life of the browser tab (sessionStorage): leaving the builder with the browser's back
 * button and coming forward again finds the draft as it was, and a reload does not lose it. Per place ("new" for a
 * place not made yet). A draft of an existing place remembers the revision it was made against: if the place has
 * changed since, the draft is set aside rather than laid over a version it never saw.
 *
 * Browser storage can be missing or refuse (a private window, blocked storage): every access is guarded, and the
 * builder works the same without it, only without this memory.
 */
const PREFIX = "cellr:builder:v1:";

export interface RememberedDraft {
  draft: BuilderDraft;
  /** The revision of the place the draft was made against (null: a new place, or "apply whatever it is now"). */
  revision: string | null;
  /**
   * Set when a new place was made but its design could not be saved: the builder opens that place with this draft
   * and says so, and saving it is then an ordinary save of an existing place (nothing is made twice).
   */
  partialCreate?: { reason: string } | undefined;
}

export function recallDraft(key: string): RememberedDraft | null {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedDraft> | null;
    if (!parsed || typeof parsed !== "object") return null;
    // the draft itself is checked by the caller (parseDraft) before anything uses it
    return {
      draft: parsed.draft as BuilderDraft,
      revision: typeof parsed.revision === "string" ? parsed.revision : null,
      partialCreate:
        parsed.partialCreate && typeof parsed.partialCreate.reason === "string"
          ? { reason: parsed.partialCreate.reason.slice(0, 300) }
          : undefined,
    };
  } catch {
    return null;
  }
}

export function rememberDraft(key: string, value: RememberedDraft): void {
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // no memory in this browser: the draft still lives on screen
  }
}

export function forgetDraft(key: string): void {
  try {
    window.sessionStorage.removeItem(PREFIX + key);
  } catch {
    // nothing to forget
  }
}
