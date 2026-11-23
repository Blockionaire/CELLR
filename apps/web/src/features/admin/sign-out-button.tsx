"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { cn } from "@/ui/cn";

/**
 * Signs this device out and goes to sign-in, coming back to the admin afterwards. The installed CELLR Admin app has
 * no address bar and no CELLR profile page, so it needs this itself. A full page load on purpose: no admin page may
 * survive in memory on a shared device.
 */
export function SignOutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/v1/auth/sign-out", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
        } finally {
          // Full load on purpose (see above), as the CELLR app's own sign-out does.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/sign-in?next=%2Fadmin");
        }
      }}
      className={cn(
        "flex min-h-11 w-full items-center gap-2 rounded-[12px] px-3 text-small font-medium text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-60",
        className,
      )}
      data-testid="admin-sign-out"
    >
      <LogOut size={18} aria-hidden="true" />
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
