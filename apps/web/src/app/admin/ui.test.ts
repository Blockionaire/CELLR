import { describe, expect, it } from "vitest";
import { failed } from "./_ui";

describe("admin page messages", () => {
  it.each([
    "Not saved: a value is not valid.",
    "Not uploaded: Too large: at most 4 MB and 4096 px.",
    "Not published: a ticked photo is not of this wine. Nothing changed.",
    "Choose a picture first.",
    "Not linked: compare both wines, give a reason and tick the confirmation.",
  ])("reports %s as not done", (m) => expect(failed(m)).toBe(true));
  it.each([
    "Wine details saved.",
    "Uploaded as a draft. Check the preview, then publish it to show it in the app.",
    "Published: this is now the wine's default picture, made from 1 photo.",
    "Marked as approved. Next: create the 2D artwork and upload it on the wine.",
    "Linked: this household wine is verified to be the catalogue wine.",
    "Unlinked. It stays unlinked until you link it again.",
  ])("reports %s as done", (m) => expect(failed(m)).toBe(false));
});
