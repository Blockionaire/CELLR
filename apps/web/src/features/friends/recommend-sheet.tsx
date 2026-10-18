"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, buttonStyles } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Sheet } from "@/ui/sheet";
import { Textarea } from "@/ui/textarea";
import { useFriends, useRecommend } from "./hooks";
import { FriendCheck } from "./person";

/** A paper plane: "send this to someone". */
export function SendIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 3 10.5 13.5" />
      <path d="m21 3-6.5 18-4-7.5L3 9.5 21 3Z" />
    </svg>
  );
}

/**
 * The round "recommend to a friend" button on a wine's page, with its sheet. Shown only once there is a friend
 * to recommend it to.
 */
export function RecommendButton({
  vintageId,
  wine,
  className,
}: {
  vintageId: string;
  /** "Domaine X Chablis 2019", for the sheet's title. */
  wine: string;
  className?: string;
}) {
  const t = useTranslations("friends");
  const tc = useTranslations("common");
  const friends = useFriends().data;
  const send = useRecommend();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");

  if (!friends?.ready || friends.friends.length === 0) return null;

  const close = () => {
    setOpen(false);
    setPicked([]);
    setNote("");
  };
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <>
      <button
        type="button"
        aria-label={t("recommend")}
        title={t("recommend")}
        onClick={() => setOpen(true)}
        className={cn(
          "grid place-items-center rounded-full text-ink shadow-raised transition-transform duration-150 ease-cellr active:scale-[0.96]",
          className,
        )}
      >
        <SendIcon size={20} />
      </button>
      <Sheet
        open={open}
        onClose={close}
        title={t("recommendTitle")}
        description={t("recommendBody", { wine })}
        closeLabel={tc("close")}
      >
        <div className="flex flex-col gap-4 pb-2">
          <ul className="flex flex-col gap-1" aria-label={t("recommendTo")}>
            {friends.friends.map((f) => (
              <li key={f.userId}>
                <FriendCheck
                  friend={f}
                  checked={picked.includes(f.userId)}
                  onChange={() => toggle(f.userId)}
                />
              </li>
            ))}
          </ul>
          <Textarea
            label={t("recommendNote")}
            placeholder={t("recommendNotePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
          />
          <Button
            size="lg"
            block
            disabled={picked.length === 0}
            loading={send.isPending}
            onClick={() =>
              send.mutate({ vintageId, friendIds: picked, note }, { onSuccess: close })
            }
          >
            {picked.length === 0
              ? t("recommendPick")
              : t("recommendSend", { count: picked.length })}
          </Button>
          <Link
            href="/friends"
            className={buttonStyles({ variant: "ghost", size: "sm", className: "self-center" })}
          >
            {t("manageFriends")}
          </Link>
        </div>
      </Sheet>
    </>
  );
}
