"use client";

import { useTranslations } from "next-intl";
import { ERROR_MESSAGES, type Spot } from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { useToast } from "@/ui/toast";
import { useBottleAction } from "./hooks";

type Place = { locationId: string | null; row: number | null; col: number | null };
/** A placed bottle as the swap needs it: which, where it was seen, and its name for the toast. */
type SwapSide = { bottleId: string; spot: Spot; name: string };

/**
 * The things you do to a bottle — open it, move it, swap it with another, remove it — each ending the same way: the
 * counts change everywhere, and a toast offers Undo. Every function resolves to an error message in
 * words, or null when it worked, so callers decide where to show a failure.
 */
export function useBottleActions() {
  const action = useBottleAction();
  const toast = useToast();
  const tOpen = useTranslations("openBottle");
  const tMove = useTranslations("moveBottle");
  const te = useTranslations();
  const fail = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);

  const undoer = (undo: () => Promise<unknown>, done?: string) => ({
    label: tOpen("undo"),
    onClick: () => {
      void undo()
        .then(() => done && toast.show(done))
        .catch((e) => toast.show(fail(e), { tone: "error" }));
    },
  });

  return {
    pending: action.isPending,

    /** `remaining` = how many of this vintage will be left after opening it. */
    async open(bottleId: string, remaining: number): Promise<string | null> {
      try {
        const { previous } = await action.mutateAsync({ bottleId, action: { action: "open" } });
        toast.show(tOpen("done", { count: remaining }), {
          flourish: "uncork",
          action: undoer(
            () => action.mutateAsync({ bottleId, action: { action: "restore", to: previous } }),
            tOpen("restored"),
          ),
        });
        return null;
      } catch (e) {
        return fail(e);
      }
    },

    async remove(bottleId: string): Promise<string | null> {
      try {
        const { previous } = await action.mutateAsync({ bottleId, action: { action: "remove" } });
        toast.show(tOpen("removed"), {
          action: undoer(
            () => action.mutateAsync({ bottleId, action: { action: "restore", to: previous } }),
            tOpen("restored"),
          ),
        });
        return null;
      } catch (e) {
        return fail(e);
      }
    },

    /**
     * Two placed bottles trade places, both at once on the server. Undo trades them back, but only while both are
     * still where this swap put them: if someone has moved one since, Undo says so and leaves their move alone.
     */
    async swap(a: SwapSide, b: SwapSide): Promise<string | null> {
      const trade = (self: SwapSide, other: SwapSide) =>
        action.mutateAsync({
          bottleId: a.bottleId,
          action: {
            action: "swap",
            with: b.bottleId,
            expected: { self: self.spot, other: other.spot },
          },
        });
      try {
        await trade(a, b);
        toast.show(tMove("swapped", { a: a.name, b: b.name }), {
          // after the swap, A is where B was and B where A was
          action: undoer(() => trade({ ...a, spot: b.spot }, { ...b, spot: a.spot })),
        });
        return null;
      } catch (e) {
        return fail(e);
      }
    },

    /** `where` is the human description of the target ("Wine fridge · Shelf 2 · Position 3"). */
    async move(bottleId: string, to: Place, where: string): Promise<string | null> {
      try {
        const { previous } = await action.mutateAsync({ bottleId, action: { action: "move", to } });
        toast.show(to.locationId ? tMove("moved", { where }) : tMove("movedOut"), {
          action: undoer(() =>
            action.mutateAsync({ bottleId, action: { action: "move", to: previous } }),
          ),
        });
        return null;
      } catch (e) {
        return fail(e);
      }
    },
  };
}
