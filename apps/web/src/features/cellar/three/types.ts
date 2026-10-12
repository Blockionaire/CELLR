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
