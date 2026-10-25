import { describe, expect, it } from "vitest";
import { cameraStateFor, startsByItself } from "./camera";

describe("when the live camera is asked for", () => {
  it("by itself only when the browser already allows it, or the person chose it earlier in this visit", () => {
    expect(startsByItself("granted", false)).toBe(true);
    expect(startsByItself("prompt", true)).toBe(true);
    expect(startsByItself(null, true)).toBe(true);
    // Otherwise it waits for a tap: choosing photos from the library never asks for the camera.
    expect(startsByItself("prompt", false)).toBe(false);
    expect(startsByItself(null, false)).toBe(false);
  });

  it("never again by itself once it is blocked", () => {
    expect(startsByItself("denied", true)).toBe(false);
  });

  it("says plainly why there is no picture", () => {
    expect(cameraStateFor(new DOMException("no", "NotAllowedError"))).toBe("denied");
    expect(cameraStateFor(new DOMException("none", "NotFoundError"))).toBe("unavailable");
    expect(cameraStateFor(new DOMException("busy", "NotReadableError"))).toBe("error");
  });
});
