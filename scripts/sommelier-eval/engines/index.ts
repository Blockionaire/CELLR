import type { Engine } from "../types";
import { baseline } from "./baseline";
import { v3 } from "./v3";

export const ENGINES: readonly Engine[] = [baseline, v3];
