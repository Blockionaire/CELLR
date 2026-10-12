"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/ui/cn";
import { HeartIcon } from "@/ui/icons";
import { useToggleFavorite } from "./hooks";

interface FavoriteButtonProps {
  wineId: string;
  /** Name for screen readers: "Favourite: Pavillon Rouge". */
  wine: string;
  favorite: boolean;
  className?: string;
  size?: number;
}

/** A heart. It is yours alone: starring a wine does not star it for the rest of the household. */
export function FavoriteButton({
  wineId,
  wine,
  favorite,
  className,
  size = 22,
}: FavoriteButtonProps) {
  const t = useTranslations("favorite");
  const { mutate } = useToggleFavorite();
  return (
    <button
      type="button"
      aria-pressed={favorite}
      aria-label={t("label", { wine })}
      onClick={() => mutate({ wineId, favorite: !favorite })}
      className={cn(
        "relative z-10 grid size-11 place-items-center rounded-full transition-[color,transform] duration-150 ease-cellr active:scale-90",
        favorite ? "text-accent-fg" : "text-ink-3 hover:text-ink",
        className,
      )}
    >
      <HeartIcon size={size} filled={favorite} />
    </button>
  );
}
