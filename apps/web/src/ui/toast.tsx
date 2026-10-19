"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "./cn";
import { fade, spring } from "./motion";

type Tone = "default" | "error";
interface ToastAction {
  label: string;
  onClick: () => void;
}
/** A small picture that plays once beside the words: "uncork" for a bottle just opened. */
type Flourish = "uncork";
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
  action?: ToastAction;
  flourish?: Flourish;
}
interface ToastApi {
  /** An `action` (e.g. Undo) keeps the toast around a little longer. */
  show: (
    message: string,
    options?: { tone?: Tone; action?: ToastAction; flourish?: Flourish },
  ) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const region = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(
    (id: number) => setItems((list) => list.filter((t) => t.id !== id)),
    [],
  );

  const show = useCallback<ToastApi["show"]>(
    (message, options) => {
      const id = nextId.current++;
      const item: ToastItem = { id, message, tone: options?.tone ?? "default" };
      if (options?.action) item.action = options.action;
      if (options?.flourish) item.flourish = options.flourish;
      setItems((list) => [...list.slice(-2), item]);
      window.setTimeout(
        () => dismiss(id),
        options?.action ? 8000 : options?.tone === "error" ? 6000 : 3500,
      );
    },
    [dismiss],
  );

  // The region lives in the browser's top layer so toasts stay visible above an open sheet.
  useEffect(() => {
    const el = region.current;
    if (!el || typeof el.showPopover !== "function") return;
    if (items.length > 0 && !el.matches(":popover-open")) el.showPopover();
    if (items.length === 0 && el.matches(":popover-open")) el.hidePopover();
  }, [items.length]);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        ref={region}
        popover="manual"
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 top-auto m-0 flex w-full max-w-none flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-4 pb-[calc(var(--nav-height)+env(safe-area-inset-bottom)+5.5rem)] lg:pb-6"
      >
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: fade }}
              transition={spring.snap}
              className={cn(
                "pointer-events-auto flex max-w-sm items-center gap-3 rounded-full bg-surface py-2.5 pl-5 pr-5 text-small shadow-raised ring-1 ring-hairline",
                t.action && "pr-2.5",
                t.tone === "error" ? "text-danger" : "text-ink",
              )}
            >
              {t.flourish === "uncork" && <Uncork />}
              <span>{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  className="shrink-0 rounded-full bg-raised px-4 py-2 font-medium text-accent-fg transition-colors duration-150 active:scale-[0.98]"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/** A bottle neck whose cork lifts off once: the opening, in a glance. Decorative. */
function Uncork() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 28"
      className="h-6 w-[1.1rem] shrink-0 overflow-visible text-accent-fg"
    >
      <path
        d="M6.5 27V15.5c0-2 1.5-3 1.5-5V9h4v1.5c0 2 1.5 3 1.5 5V27"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <rect
        className="uncork"
        x="7.75"
        y="3.5"
        width="4.5"
        height="6"
        rx="1.2"
        fill="currentColor"
      />
    </svg>
  );
}
