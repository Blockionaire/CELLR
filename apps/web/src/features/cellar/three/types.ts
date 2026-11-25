import type { WineType } from "@cellr/domain";
import type { BottleShape } from "@/ui/bottle-glyph";
import type { LabelSpec } from "./label-texture";

export interface SceneBottle {
  id: string;
  row: number;
  col: number;
  type: WineType;
  shape: BottleShape;
}

/** The bottle that has been taken out of its slot and is on display, with what is printed on its label. */
export interface ShownBottle {
  bottle: SceneBottle;
  label: LabelSpec;
}

/** A free spot on offer in the existing view (3D Quick Add on a place from before templates): always index 1. */
export interface SceneSpot {
  row: number;
  col: number;
}
