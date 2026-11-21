/**
 * DISH TEMPLATES, all regions. Written for CELLR from general culinary knowledge; drafted by an AI engineering agent
 * and not yet reviewed by a human expert (`reviewed: false`). Scales: weight/intensity 1–5, every other axis 0–3.
 * The templates live in three files by region and course; this joins them.
 */
import type { DishTemplate } from "../types";
import { DISHES_EUROPE } from "./dishes-europe";
import { DISHES_SWEET_CHEESE } from "./dishes-sweet-cheese";
import { DISHES_WORLD } from "./dishes-world";

export const DISH_TEMPLATES: readonly DishTemplate[] = [
  ...DISHES_EUROPE,
  ...DISHES_WORLD,
  ...DISHES_SWEET_CHEESE,
];
