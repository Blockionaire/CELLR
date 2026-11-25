"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether shared racks are open on this page, as the SERVER decided it (`getSharedRacksAccess().open`): handed in by
 * the page, never read from anything the browser holds. Left out (every page that does not set it), it is closed.
 *
 * It exists so that a screen deep inside a page (a bottle's spot in a list, a sheet that moves a bottle) can ask the
 * question without every screen above it passing a prop down. Closed, the parts of `lazy.tsx` that read it render
 * exactly what the screen rendered before, and nothing of shared racks is fetched, asked for or downloaded.
 */
const SharedRacksOpen = createContext(false);

export function SharedRacksGate({ open, children }: { open: boolean; children: ReactNode }) {
  return <SharedRacksOpen.Provider value={open}>{children}</SharedRacksOpen.Provider>;
}

export const useSharedRacksOpen = () => useContext(SharedRacksOpen);
