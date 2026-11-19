import { describe, expect, it } from "vitest";
import { labelSpecOf, selectedIn, whereOf } from "./product-details";

const url = (id: string, size: string) => `/api/v1/images/${id}?size=${size}`;
const bottle = {
  producer: "Château Margaux",
  wineName: "Pavillon Rouge",
  year: 2015,
  type: "red" as const,
  image: null,
};

describe("where a bottle is, in words that claim no more than is known", () => {
  const at = (index: number) => ({ row: 2, col: 3, index });

  it("one bottle per position: shelf and position", () => {
    expect(whereOf({ indexMeaning: "single", arrangementKnown: true }, at(1))).toEqual({
      kind: "spot",
      row: 2,
      col: 3,
      index: 1,
    });
  });

  it("a known depth: index 1 is the front, a higher one lies behind it", () => {
    const deep = { indexMeaning: "depth" as const, arrangementKnown: true };
    expect(whereOf(deep, at(1)).kind).toBe("front");
    expect(whereOf(deep, at(2))).toMatchObject({ kind: "behind", index: 2 });
  });

  it("a bin: the compartment only, whatever the counter is (an ordinal is never a depth)", () => {
    const bin = { indexMeaning: "ordinal" as const, arrangementKnown: true };
    for (const index of [1, 2, 7]) expect(whereOf(bin, at(index)).kind).toBe("compartment");
  });

  it("an arrangement that is not known stays unknown, whatever the index and whatever a template would say", () => {
    for (const indexMeaning of ["single", "depth", "ordinal"] as const)
      for (const index of [1, 2])
        expect(whereOf({ indexMeaning, arrangementKnown: false }, at(index)).kind).toBe("unknown");
  });
});

describe("what the bottle on display wears", () => {
  it("no photo: the label is drawn from the wine's own names, and nothing is asked for", () => {
    expect(labelSpecOf(bottle, "Bordeaux, France", url)).toEqual({
      producer: "Château Margaux",
      name: "Pavillon Rouge",
      year: 2015,
      place: "Bordeaux, France",
      type: "red",
      photoUrl: null,
      textured: false,
      backPhotoUrl: null,
    });
  });

  it("its own label photo: the straightened label where there is one, else the photo", () => {
    const image = { id: "img-1", blurColor: null, width: 900, height: 1200 };
    expect(labelSpecOf({ ...bottle, image: { ...image, texture: true } }, "", url)).toMatchObject({
      photoUrl: "/api/v1/images/img-1?size=texture",
      textured: true,
    });
    expect(labelSpecOf({ ...bottle, image }, "", url)).toMatchObject({
      photoUrl: "/api/v1/images/img-1?size=photo",
      textured: false,
    });
  });

  it("the back label is the wine's own photo of it, once the details have brought one", () => {
    const back = { id: "img-back", blurColor: null, width: 800, height: 1000 };
    expect(labelSpecOf(bottle, "", url, back).backPhotoUrl).toBe(
      "/api/v1/images/img-back?size=photo",
    );
    expect(labelSpecOf(bottle, "", url, null).backPhotoUrl).toBeNull();
  });

  it("a wine without a year or a place is drawn without them, not with invented ones", () => {
    const spec = labelSpecOf({ ...bottle, year: null }, "", url);
    expect(spec.year).toBeNull();
    expect(spec.place).toBe("");
  });

  it("the same bottle gives the same label, word for word (the hero re-prints only when it changes)", () => {
    expect(JSON.stringify(labelSpecOf(bottle, "Bordeaux", url))).toBe(
      JSON.stringify(labelSpecOf({ ...bottle }, "Bordeaux", url)),
    );
  });
});

describe("the chosen bottle belongs to the place on screen", () => {
  const here = [{ bottleId: "a" }, { bottleId: "b" }];

  it("a bottle of this place is chosen", () => {
    expect(selectedIn({ unitId: "u1", bottleId: "a" }, "u1", here)).toBe("a");
  });

  it("a choice made in another place is no choice here, even with the same bottle id on screen", () => {
    expect(selectedIn({ unitId: "u2", bottleId: "a" }, "u1", here)).toBeNull();
  });

  it("a bottle that has since left this place (opened, moved, removed) is no longer chosen", () => {
    expect(selectedIn({ unitId: "u1", bottleId: "gone" }, "u1", here)).toBeNull();
    expect(selectedIn(null, "u1", here)).toBeNull();
  });
});
