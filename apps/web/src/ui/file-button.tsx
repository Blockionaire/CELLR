"use client";

import { useId, type ChangeEvent, type ReactNode } from "react";
import { buttonStyles } from "./button";
import { cn } from "./cn";

interface FileButtonProps {
  children: ReactNode;
  onFile: (file: File) => void;
  /** Lets several files be picked at once (from the library); each one goes to `onFile`, in order. */
  multiple?: boolean;
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
  multiple,
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
    const files = [...(event.target.files ?? [])];
    event.target.value = ""; // choosing the same file again must work
    for (const file of multiple ? files : files.slice(0, 1)) onFile(file);
  };
  return (
    <>
      <input
        id={id}
        type="file"
        accept={accept}
        capture={capture}
        multiple={multiple}
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
