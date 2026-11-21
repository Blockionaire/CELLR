import type { Engine } from "../types";
import { baseline } from "./baseline";
import { v3 } from "./v3";
import { v3Oracle } from "./hybrid";
import { v3App } from "./v3-app";

export const ENGINES: readonly Engine[] = [baseline, v3, v3App, v3Oracle];
