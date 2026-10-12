"use client";

import { useId, type ChangeEvent, type ReactNode } from "react";
import { buttonStyles } from "./button";
import { cn } from "./cn";

interface FileButtonProps {
  children: ReactNode;
  onFile: (file: File) => void;
  /** "image/*" lets people pick from the library or the camera; add `capture` to go straight to the camera. */
  accept?: string;
  capture?: "environment" | "user";
  disabled?: boolean | undefined;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  className?: string;
}

/**
 * A button that opens the file picker. It is a real label for a real input (so it works with a keyboard and a
 * screen reader, and on a phone it opens the camera or the library), styled like every other button.
 */
export function FileButton({
  children,
  onFile,
  accept = "image/*",
  capture,
  disabled,
  variant = "secondary",
  size = "md",
  block,
  className,
}: FileButtonProps) {
  const id = useId();
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // choosing the same file again must work
    if (file) onFile(file);
  };
  return (
    <>
      <input
        id={id}
        type="file"
        accept={accept}
        capture={capture}
        onChange={choose}
        disabled={disabled}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={cn(
          buttonStyles({ variant, size, block: block ?? false }),
          "cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-fg",
          disabled && "pointer-events-none opacity-45",
          className,
        )}
      >
        {children}
      </label>
    </>
  );
}
