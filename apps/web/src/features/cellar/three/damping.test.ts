import { describe, expect, it } from "vitest";
import { dampingFor, GLIDE_PER_60HZ_FRAME } from "./damping";

/** Frames OrbitControls draws until what is left of a turn falls below `rest` of where it started. */
function framesToRest(frameSeconds: number, rest = 1e-3) {
  const share = dampingFor(frameSeconds, GLIDE_PER_60HZ_FRAME);
  let left = 1;
  let frames = 0;
  while (left > rest) {
    left *= 1 - share;
    frames += 1;
  }
  return frames;
}

describe("the camera's glide follows time, not frames", () => {
  it("is what it always was at 60 frames a second", () => {
    expect(dampingFor(1 / 60, GLIDE_PER_60HZ_FRAME)).toBeCloseTo(GLIDE_PER_60HZ_FRAME, 12);
  });

  it("leaves the same share of a turn after the same time, at any frame rate", () => {
    const leftAfter = (fps: number, seconds: number) =>
      Math.pow(1 - dampingFor(1 / fps, GLIDE_PER_60HZ_FRAME), fps * seconds);
    for (const fps of [3, 10, 30, 120])
      expect(leftAfter(fps, 0.5)).toBeCloseTo(leftAfter(60, 0.5), 9);
  });

  it("comes to rest in a handful of frames where frames are slow, not in seventy", () => {
    expect(framesToRest(1 / 60)).toBeGreaterThan(60);
    // a software renderer: about 400 ms a frame
    expect(framesToRest(0.4)).toBeLessThanOrEqual(4);
    expect(framesToRest(0.1)).toBeLessThanOrEqual(13);
  });

  it("never applies more than all of what is left, and has a share for a frame of no length", () => {
    expect(dampingFor(60, GLIDE_PER_60HZ_FRAME)).toBeLessThanOrEqual(1);
    expect(dampingFor(Infinity, GLIDE_PER_60HZ_FRAME)).toBeLessThanOrEqual(1);
    expect(dampingFor(0, GLIDE_PER_60HZ_FRAME)).toBe(GLIDE_PER_60HZ_FRAME);
    expect(dampingFor(Number.NaN, GLIDE_PER_60HZ_FRAME)).toBe(GLIDE_PER_60HZ_FRAME);
  });
});
