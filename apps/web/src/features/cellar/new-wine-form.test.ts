import { describe, expect, it } from "vitest";
import { checkWineFields, fieldsOfDraft } from "./new-wine-form";

const t = (key: "typeRequired") => key;
const te = ((key: string) => key) as Parameters<typeof checkWineFields>[3];

describe("the wine fields shared by the add flow and the scan review", () => {
  it("start from a draft, with an open kind left open and nothing else made up", () => {
    expect(
      fieldsOfDraft({
        producer: "Bollinger",
        name: "Special Cuvée",
        type: null,
        countryCode: null,
        region: null,
      }),
    ).toEqual({
      producer: "Bollinger",
      name: "Special Cuvée",
      type: null,
      countryCode: "",
      region: "",
    });
    // nothing read: an empty form (red preselected, as the manual add flow always did)
    expect(fieldsOfDraft(undefined, "Typed")).toEqual({
      producer: "",
      name: "Typed",
      type: "red",
      countryCode: "",
      region: "",
    });
  });

  it("are not ready without a kind, a producer or a name", () => {
    const base = {
      producer: "Tempier",
      name: "Bandol",
      type: "red" as const,
      countryCode: "",
      region: "",
    };
    expect(checkWineFields({ ...base, type: null }, null, t, te)).toEqual({
      ok: false,
      error: "typeRequired",
    });
    expect(checkWineFields({ ...base, producer: " " }, null, t, te).ok).toBe(false);
    expect(checkWineFields({ ...base, name: "" }, null, t, te).ok).toBe(false);
  });

  it("send what was typed, a country only when chosen, and the record it came from (R-27)", () => {
    const ok = checkWineFields(
      { producer: "Tempier", name: "Bandol", type: "red", countryCode: "", region: "Provence" },
      "7f1d1c64-2f5e-4c43-9a59-0f3f1d0b8a11",
      t,
      te,
    );
    expect(ok).toEqual({
      ok: true,
      input: expect.objectContaining({
        producer: "Tempier",
        name: "Bandol",
        type: "red",
        region: "Provence",
        sourceRecordId: "7f1d1c64-2f5e-4c43-9a59-0f3f1d0b8a11",
      }),
    });
    expect(ok.ok && "countryCode" in ok.input && ok.input.countryCode).toBeFalsy();
  });
});
