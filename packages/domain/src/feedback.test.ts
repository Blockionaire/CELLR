import { describe, expect, it } from "vitest";
import {
  coarseDevice,
  FEEDBACK_MESSAGE_MAX,
  parseFeedbackCategory,
  SubmitFeedbackSchema,
} from "./feedback";

describe("beta feedback", () => {
  it("a specific report is accepted; empty optional context becomes nothing", () => {
    const parsed = SubmitFeedbackSchema.parse({
      category: "bug",
      message: "  The shutter did nothing.\nI expected a photo.  ",
      location: "  ",
    });
    expect(parsed).toEqual({
      category: "bug",
      message: "The shutter did nothing.\nI expected a photo.",
      location: null,
      device: null,
    });
  });

  it("category and a real description are required; lengths are bounded", () => {
    expect(SubmitFeedbackSchema.safeParse({ message: "Long enough message" }).success).toBe(false);
    expect(
      SubmitFeedbackSchema.safeParse({ category: "praise", message: "Long enough message" })
        .success,
    ).toBe(false);
    expect(SubmitFeedbackSchema.safeParse({ category: "idea", message: "too short" }).success).toBe(
      false,
    );
    expect(
      SubmitFeedbackSchema.safeParse({
        category: "idea",
        message: "x".repeat(FEEDBACK_MESSAGE_MAX + 1),
      }).success,
    ).toBe(false);
    expect(
      SubmitFeedbackSchema.safeParse({
        category: "idea",
        message: "Long enough message",
        location: "x".repeat(121),
      }).success,
    ).toBe(false);
  });

  it("control characters are stripped; a user id from the client is ignored", () => {
    const parsed = SubmitFeedbackSchema.parse({
      category: "other",
      message: "Hello\u0007 there, this is fine",
      location: "Scan\nscreen",
      userId: "someone-else",
    } as never);
    expect(parsed.message).toBe("Hello  there, this is fine");
    expect(parsed.location).toBe("Scan screen");
    expect(parsed).not.toHaveProperty("userId");
  });

  it("the device line is coarse: kind, browser family and app mode, never versions", () => {
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
    expect(coarseDevice(iphone, true)).toBe("iPhone · Safari · home-screen app");
    const pixel =
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
    expect(coarseDevice(pixel, false)).toBe("Android · Chrome · browser tab");
    expect(coarseDevice(iphone, true)).not.toMatch(/18|605|Pixel/);
  });

  it("an admin filter only takes a known category", () => {
    expect(parseFeedbackCategory("bug")).toBe("bug");
    expect(parseFeedbackCategory("all")).toBeNull();
    expect(parseFeedbackCategory(["bug"])).toBeNull();
  });
});
