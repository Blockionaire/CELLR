import type { PhotoStage } from "@cellr/domain";
import { cn } from "@/ui/cn";
import { STAGE_LABEL, STAGE_ORDER } from "./labels";

/** The workflow as steps, the current one marked (in words, not colour alone). */
export function Workflow({ stage }: { stage: PhotoStage }) {
  const rejected = stage === "rejected";
  const current = rejected ? -1 : STAGE_ORDER.indexOf(stage);
  return (
    <ol
      aria-label="Workflow"
      data-testid="workflow"
      data-stage={stage}
      className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-5"
    >
      {STAGE_ORDER.map((s, i) => {
        const done = !rejected && i < current;
        const now = i === current;
        return (
          <li
            key={s}
            aria-current={now ? "step" : undefined}
            className={cn(
              "rounded-[12px] border px-3 py-2 text-caption",
              now
                ? "border-accent-fg bg-surface text-ink"
                : done
                  ? "border-hairline bg-surface text-ink-2"
                  : "border-dashed border-hairline text-ink-3",
            )}
          >
            <span className="block font-semibold">
              {done ? "✓ " : `${i + 1}. `}
              {now ? "Now" : done ? "Done" : "Next"}
            </span>
            <span className="block">{STAGE_LABEL[s]}</span>
          </li>
        );
      })}
      <li
        aria-current={rejected ? "step" : undefined}
        className={cn(
          "rounded-[12px] border px-3 py-2 text-caption",
          rejected
            ? "border-danger bg-surface text-ink"
            : "border-dashed border-hairline text-ink-3",
        )}
      >
        <span className="block font-semibold">{rejected ? "Now" : "Or"}</span>
        <span className="block">{STAGE_LABEL.rejected}</span>
      </li>
    </ol>
  );
}
