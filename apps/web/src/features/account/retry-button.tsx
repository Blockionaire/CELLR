"use client";

import { Button } from "@/ui/button";

export function RetryButton({ label }: { label: string }) {
  return (
    <Button size="lg" onClick={() => window.location.reload()}>
      {label}
    </Button>
  );
}
