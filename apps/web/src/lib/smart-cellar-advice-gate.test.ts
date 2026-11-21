import { describe, expect, it } from "vitest";
import { adviceOpenIn } from "./smart-cellar-advice-gate";
import { PLACEMENT_CLOSED } from "./smart-cellar-placement-gate";

const OPEN = { open: true, canWrite: false, depth: false };
const PREVIEW = { VERCEL_ENV: "preview", CELLR_SMART_CELLAR_ADVICE: "1" };

describe("the advice gate", () => {
  it("is off by default and needs exactly '1'", () => {
    expect(adviceOpenIn({ VERCEL_ENV: "preview" }, OPEN)).toBe(false);
    expect(adviceOpenIn({ VERCEL_ENV: "preview", CELLR_SMART_CELLAR_ADVICE: "true" }, OPEN)).toBe(
      false,
    );
    expect(adviceOpenIn(PREVIEW, OPEN)).toBe(true);
  });

  it("stays closed on production and on a deployment that cannot be told, whatever is set", () => {
    expect(adviceOpenIn({ ...PREVIEW, VERCEL_ENV: "production" }, OPEN)).toBe(false);
    expect(adviceOpenIn({ CELLR_SMART_CELLAR_ADVICE: "1", NODE_ENV: "production" }, OPEN)).toBe(
      false,
    );
  });

  it("needs the placement experience open; read-only placement is enough (advice writes nothing)", () => {
    expect(adviceOpenIn(PREVIEW, PLACEMENT_CLOSED)).toBe(false);
    expect(adviceOpenIn(PREVIEW, { open: true, canWrite: false, depth: false })).toBe(true);
  });
});
