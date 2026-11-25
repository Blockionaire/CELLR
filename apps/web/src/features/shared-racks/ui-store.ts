"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the "Shared racks" sheet (my racks, invitations, a new rack) is open. It is opened from two places that
 * are mounted apart (a chip in the row of places, a line under the cellar), so the one bit lives here.
 */
let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const openManage = () => {
  open = true;
  emit();
};
export const closeManage = () => {
  open = false;
  emit();
};
export const useManageOpen = () =>
  useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
