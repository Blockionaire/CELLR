import type { Engine } from "../types";
import { baseline } from "./baseline";
import { v1Fallback, v1FallbackPlain } from "./v1-fallback";
import { v3 } from "./v3";
import { v3App } from "./v3-app";

export const ENGINES: readonly Engine[] = [baseline, v1Fallback, v1FallbackPlain, v3, v3App];
