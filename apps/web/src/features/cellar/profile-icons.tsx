import {
  Apple,
  Banana,
  Barrel,
  Bean,
  Beef,
  Bone,
  CakeSlice,
  Candy,
  Cherry,
  Citrus,
  CookingPot,
  Drumstick,
  Fish,
  Flame,
  Flower2,
  Gem,
  Grape,
  Ham,
  Leaf,
  Martini,
  Mountain,
  Nut,
  Rabbit,
  Salad,
  Shrimp,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { FlavorGroup, PairingKind } from "@cellr/domain";

type IconComponent = LucideIcon | ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/** A wedge of cheese, drawn to match the rest (the icon set has none). */
function CheeseWedge({ size = 24, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d="M3 16.5 14.5 7l6.5 3.5v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M3 16.5h18" />
      <circle cx="9" cy="17.75" r=".75" />
      <circle cx="15.5" cy="12.75" r="1" />
    </svg>
  );
}

export const PAIRING_ICON: Record<PairingKind, IconComponent> = {
  beef: Beef,
  lamb: Bone,
  pork: Ham,
  poultry: Drumstick,
  game: Rabbit,
  fish: Fish,
  shellfish: Shrimp,
  cheese: CheeseWedge,
  pasta: CookingPot,
  vegetarian: Salad,
  spicy: Flame,
  dessert: CakeSlice,
  aperitif: Martini,
};

export const FLAVOR_ICON: Record<FlavorGroup, IconComponent> = {
  red_fruit: Cherry,
  black_fruit: Grape,
  citrus: Citrus,
  tree_fruit: Apple,
  tropical: Banana,
  dried_fruit: Bean,
  floral: Flower2,
  herbal: Leaf,
  spice: Sparkles,
  oak: Barrel,
  earth: Mountain,
  mineral: Gem,
  nutty: Nut,
  sweet: Candy,
};

/** The colour of each aroma family (as wine apps colour them); the name is always written beside it. */
export const FLAVOR_COLOUR: Record<FlavorGroup, string> = {
  red_fruit: "#c2324a",
  black_fruit: "#6a3a86",
  citrus: "#d9a21b",
  tree_fruit: "#7f9e2c",
  tropical: "#e98a1f",
  dried_fruit: "#9a5a3a",
  floral: "#c45f97",
  herbal: "#3f8a4f",
  spice: "#b5532b",
  oak: "#8a6239",
  earth: "#7a6250",
  mineral: "#6f8394",
  nutty: "#a8844f",
  sweet: "#c9922f",
};
