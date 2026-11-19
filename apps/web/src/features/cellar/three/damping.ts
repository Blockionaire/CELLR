/**
 * How much of the camera's glide is used up on a frame, from how long that frame took.
 *
 * OrbitControls damps per FRAME: every frame it draws, it applies `dampingFactor` of what is left of a turn or a
 * slide and keeps the rest for the next frame. Its glide therefore lasts a number of frames (about seventy until it
 * reports no change), not a time. At 60 frames a second that is a short, soft coast of about a second; where frames
 * come slowly it is the same seventy frames, each drawn at full cost: half a minute at three frames a second, on a
 * slow phone or under a software renderer (SwiftShader on a CI runner, where it starved every test that turned the
 * view). Given the frame's length, the share follows the time instead: the same coast at any frame rate, so a
 * slow device draws only a handful of frames to come to rest, and a 120 Hz screen glides as long as a 60 Hz one.
 *
 * `per60` is the share for one frame at 60 a second (what `dampingFactor` used to be set to, once).
 */
export function dampingFor(seconds: number, per60: number): number {
  if (!(seconds > 0)) return per60;
  // (a frame after a long stillness: all of what is left, which is nothing to speak of by then)
  return 1 - Math.pow(1 - per60, Math.min(seconds, 10) * 60);
}

/** The glide of both 3D views: 9 % of what is left on each frame at 60 frames a second. */
export const GLIDE_PER_60HZ_FRAME = 0.09;
