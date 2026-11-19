/**
 * CELLR's food knowledge: ingredients, techniques, sauces and named dishes. Written for CELLR from general culinary
 * knowledge; drafted by an AI engineering agent and not yet reviewed by a human expert (`reviewed: false`).
 * Scales: weight/intensity 1–5, every other structure axis 0–3; technique deltas −2 … +2.
 */
import type { FoodKnowledge } from "../compose";
import { DRAFT, type Provenance } from "../types";
import { DISH_TEMPLATES } from "./dishes";
import { INGREDIENTS } from "./ingredients";
import { SAUCES } from "./sauces";
import { TECHNIQUES } from "./techniques";

export { DISH_TEMPLATES, INGREDIENTS, SAUCES, TECHNIQUES };

export const FOOD: FoodKnowledge = {
  ingredients: INGREDIENTS,
  techniques: TECHNIQUES,
  sauces: SAUCES,
  dishes: DISH_TEMPLATES,
};

/** Who wrote the knowledge and whether an expert has checked it. */
export const FOOD_PROVENANCE: Provenance = DRAFT;

/** Bumped whenever the data changes in a way a stored reading could notice. */
export const FOOD_KNOWLEDGE_VERSION = "2026.11.1";
