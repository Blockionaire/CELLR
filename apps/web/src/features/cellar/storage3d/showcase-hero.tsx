"use client";

import { useFrame, useThree, type RootState } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  LABEL_ASPECT,
  makeBackLabelTexture,
  makeLabelTexture,
  type LabelSpec,
} from "../three/label-texture";
import { BOTTLE_LENGTH, SHOWCASE_DEPTH } from "../three/layout";
import {
  buildHeroKit,
  dressHero,
  labelWraps,
  lookAt,
  prewarmSet,
  printLabel,
  shadeHero,
  veilColour,
  type HeroKit,
} from "./hero-kit";
import { QUALITY, type PlacedBottle, type Quality, type RenderModel } from "./model";
import { AIR, BOTTLE_R } from "./parts";
import { Owned, poseMatrix } from "./resources";
import {
  FILM_SECONDS,
  HANDOVER,
  displayFor,
  filmAt,
  inspectionFrame,
  newFrame,
  type Display,
  type InspectionLayout,
} from "./showcase-film";
import { targetOf, type ShowcasePhase, type ShowcaseState } from "./showcase-machine";
import { planExtraction, type ExtractionPlan } from "./showcase-plan";

/**
 * The bottle that is out, inside the 3D view (Smart Cellar 3D, sprint 2B.1). It plays the film of
 * showcase-film.ts for the plan of showcase-plan.ts, and looks after what surrounds the movement:
 *
 * - THE PLACE STEPS BACK AS A PICTURE. Once the bottle is clear of it (at once, for an inspection transition) the
 *   place is drawn one last time without the bottle, copied to a 2D canvas behind the 3D one, and not drawn again
 *   until the bottle is back: while a bottle is looked at, every frame draws that one bottle and nothing else. The
 *   camera does not move meanwhile, so the picture and the live place are the same to the pixel when they swap.
 * - A NEW SIZE, A NEW PICTURE. When the view changes size while the picture stands in, it is taken again at the new
 *   size, from the same camera.
 * - NOTHING OUTLIVES IT. Closing (for any reason, a cancelled movement included) puts the place back, removes the
 *   picture, darkens the studio lights, takes the label off the shared materials and releases what was made.
 *
 * It decides nothing about which bottle, which spot or what may happen next: that is the machine's and the plan's.
 */
export interface ShowcaseHeroProps {
  bottle: PlacedBottle;
  plan: ExtractionPlan;
  model: RenderModel;
  kit: HeroKit;
  level: Quality;
  phase: ShowcasePhase;
  run: number;
  label: LabelSpec | null;
  layout: InspectionLayout;
  safeTop: number;
  reducedMotion: boolean;
  /** The storageRef view's furniture and bottles: hidden while the picture stands in for them. */
  storageRef: React.RefObject<THREE.Group | null>;
  /** The element behind the 3D canvas that holds the picture of the place. */
  backdropRef: React.RefObject<HTMLDivElement | null>;
  keyLightRef: React.RefObject<THREE.SpotLight | null>;
  rimLightRef: React.RefObject<THREE.PointLight | null>;
  /** The colour the place fades towards when no picture of it could be taken. */
  veil: string;
  onArrived: (run: number) => void;
  onReturned: (run: number) => void;
  /** Whether the last press was a drag (turning the bottle), so that it is not read as a tap. */
  onDrag: (moved: boolean) => void;
}

/** 0 at the hand-over, 1 a little after it: how far the studio lights have come up. */
const ramp = (from: number, p: number) => {
  const t = Math.min(1, Math.max(0, (p - from) / 0.2));
  return t * t * (3 - 2 * t);
};
/** A test-only pause on the way home (window.__cellrHoldReturn = progress); 0 in normal use. */
const heldReturn = () => (globalThis as { __cellrHoldReturn?: number }).__cellrHoldReturn ?? 0;
const noRaycast = () => null;
/** Writes a measurement onto an element, for the gallery's readout and the tests. */
function mark(el: HTMLElement, key: string, value: string | null) {
  if (value === null) delete el.dataset[key];
  else el.dataset[key] = value;
}

interface Live {
  p: number;
  yaw: number;
  spin: number;
  frozen: boolean;
  /** No picture could be taken: the place stays live behind a veil. */
  veiled: boolean;
  still: HTMLCanvasElement | null;
  stillView: THREE.Matrix4 | null;
  removal: number | null;
  arrived: boolean;
  returned: boolean;
  moved: boolean;
  display: Display;
  frame: ReturnType<typeof newFrame>;
}

export function ShowcaseHero({
  bottle,
  plan,
  model,
  kit,
  level,
  phase,
  run,
  label,
  layout,
  safeTop,
  reducedMotion,
  storageRef,
  backdropRef,
  keyLightRef,
  rimLightRef,
  veil,
  onArrived,
  onReturned,
  onDrag,
}: ShowcaseHeroProps) {
  const { gl, invalidate } = useThree();
  const hero = useRef<THREE.Group>(null);
  const veilMesh = useRef<THREE.Mesh>(null);
  const floorMesh = useRef<THREE.Mesh>(null);
  const contactMesh = useRef<THREE.Mesh>(null);
  const live = useRef<Live | null>(null);
  if (live.current === null)
    live.current = {
      p: 0,
      yaw: 0,
      spin: 0,
      frozen: false,
      veiled: false,
      still: null,
      stillView: null,
      removal: null,
      arrived: false,
      returned: false,
      moved: false,
      display: { position: new THREE.Vector3(), facing: new THREE.Quaternion(), scale: 1 },
      frame: newFrame(),
    };
  const target = targetOf(phase);
  const quality = QUALITY[level];
  const geometry = kit.geometry(bottle.shape);
  // a counter is not a bottle resting on a shelf: no shadow under it, and it is not taken off the picture
  const resting = quality.shadows && model.renderer === "grid" && plan.origin.lie === "z";
  const centre = useMemo(
    () =>
      new THREE.Vector3(
        (model.bounds.min[0] + model.bounds.max[0]) / 2,
        (model.bounds.min[1] + model.bounds.max[1]) / 2,
        (model.bounds.min[2] + model.bounds.max[2]) / 2,
      ),
    [model.bounds],
  );

  // ---- The label: drawn once the fonts are in; until then the glass wears plain paper ---------------------------
  const [aspects, setAspects] = useState({ front: LABEL_ASPECT, back: 0.7 });
  const wraps = useMemo(() => {
    const owned = new Owned();
    return { owned, ...labelWraps(bottle.shape, aspects.front, aspects.back, owned) };
  }, [bottle.shape, aspects]);
  useEffect(() => () => wraps.owned.dispose(), [wraps]);

  const spoken = label ? JSON.stringify(label) : null;
  useEffect(() => {
    const canvas = gl.domElement;
    dressHero(kit, bottle.type, plan.mode === "emerge");
    if (spoken === null) return;
    let alive = true;
    const made: THREE.Texture[] = [];
    const spec = JSON.parse(spoken) as LabelSpec;
    const anisotropy = gl.capabilities.getMaxAnisotropy();
    const wear = (side: "front" | "back", texture: THREE.Texture) => {
      if (!alive) return texture.dispose();
      made.push(texture);
      printLabel(kit[side], kit, texture);
      const data = texture.userData as { aspect?: number; photo?: boolean };
      if (data.aspect)
        setAspects((a) => (a[side] === data.aspect ? a : { ...a, [side]: data.aspect! }));
      mark(canvas, `${side}Label`, data.photo ? "photo" : "drawn");
      invalidate();
    };
    void makeLabelTexture(spec, anisotropy).then((t) => wear("front", t));
    void makeBackLabelTexture(spec, anisotropy).then((t) => wear("back", t));
    return () => {
      alive = false;
      printLabel(kit.front, kit, null);
      printLabel(kit.back, kit, null);
      for (const t of made) t.dispose();
      mark(canvas, "frontLabel", null);
      mark(canvas, "backLabel", null);
    };
  }, [spoken, kit, bottle.type, plan.mode, gl, invalidate]);

  // ---- Leaving: the place comes back, whatever state the movement was in ---------------------------------------
  useEffect(() => {
    const s = live.current!;
    const place = storageRef;
    const behind = backdropRef;
    const canvas = gl.domElement;
    const lights = [keyLightRef, rimLightRef];
    veilColour(kit, veil);
    invalidate();
    return () => {
      if (s.removal !== null) cancelAnimationFrame(s.removal);
      s.removal = null;
      if (place.current) place.current.visible = true;
      behind.current?.replaceChildren();
      s.still = null;
      s.frozen = false;
      for (const l of lights)
        if (l.current) {
          l.current.intensity = 0;
          l.current.visible = false;
        }
      mark(canvas, "still", null);
      invalidate();
    };
  }, [storageRef, backdropRef, keyLightRef, rimLightRef, kit, veil, gl, invalidate]);

  // ---- Turning it with a finger or the mouse --------------------------------------------------------------------
  useEffect(() => {
    if (target !== 1) return;
    const el = gl.domElement;
    const s = live.current!;
    let down = false;
    let startX = 0;
    let lastX = 0;
    let lastT = 0;
    const onDown = (e: PointerEvent) => {
      down = true;
      startX = lastX = e.clientX;
      lastT = e.timeStamp;
      s.spin = 0;
      onDrag(false);
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - lastX;
      if (Math.abs(e.clientX - startX) > 5) onDrag(true);
      s.yaw += dx * 0.012;
      const dt = Math.max(0.008, (e.timeStamp - lastT) / 1000);
      s.spin = Math.max(-9, Math.min(9, ((dx * 0.012) / dt) * 0.6));
      lastX = e.clientX;
      lastT = e.timeStamp;
      invalidate();
    };
    const onUp = (e: PointerEvent) => {
      // held still before letting go: it stays where it was put, without a last flick
      if (down && e.timeStamp - lastT > 90) s.spin = 0;
      // how far it has been turned (radians), readable from outside
      if (down) mark(el, "showcaseYaw", s.yaw.toFixed(3));
      down = false;
      invalidate();
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [target, gl, invalidate, onDrag]);

  // a change of direction is a new movement to finish
  useEffect(() => {
    const s = live.current!;
    if (target === 1) s.returned = false;
    else s.arrived = false;
    invalidate();
  }, [target, invalidate]);

  // ---- The film ---------------------------------------------------------------------------------------------------
  useFrame((state, rawDelta) => {
    const g = hero.current;
    const s = live.current!;
    if (!g) return;
    const delta = Math.min(rawDelta, 0.1);
    const canvas = state.gl.domElement;

    // progress
    const goal = target === 1 ? 1 : heldReturn();
    if (reducedMotion) s.p = goal;
    else {
      const seconds = FILM_SECONDS[plan.mode];
      const step = delta / (target === 1 ? seconds.out : seconds.home);
      s.p = s.p < goal ? Math.min(goal, s.p + step) : Math.max(goal, s.p - step);
    }
    if (!s.moved && s.p > 0) {
      s.moved = true;
      // from the tap to the first picture in which the bottle has moved
      const opened = performance.getEntriesByName("cellr:inspect-open").at(-1);
      if (opened) mark(canvas, "inspectLatency", (performance.now() - opened.startTime).toFixed(1));
    }
    s.yaw += s.spin * delta;
    s.spin *= Math.exp(-3.2 * delta);
    if (Math.abs(s.spin) < 0.01) s.spin = 0;

    // where it is looked at: a fixed spot in front of the camera, which does not move while a bottle is out
    const cam = state.camera as THREE.PerspectiveCamera;
    cam.updateMatrixWorld();
    const depth = Math.min(SHOWCASE_DEPTH, Math.max(1.5, cam.position.distanceTo(centre) * 0.45));
    displayFor(
      cam,
      state.size,
      inspectionFrame(layout, state.size.width, state.size.height, safeTop),
      depth,
      s.display,
    );
    const frame = filmAt(plan, s.p, s.display, s.yaw, s.frame);
    g.position.copy(frame.position);
    g.quaternion.copy(frame.quaternion);
    g.scale.setScalar(Math.max(0.0001, frame.scale));
    lookAt(kit, bottle.type, quality, frame.rise, frame.opacity);

    // its shadow on the shelf: there while it rests, gone as it leaves
    const contact = contactMesh.current;
    if (contact) {
      const [x, y, z] = plan.origin.position;
      contact.position.set(x, y - BOTTLE_R - AIR + 0.006, z);
    }
    // a pool of shadow at its foot on display
    const up = scratch.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const floor = floorMesh.current;
    if (floor) {
      floor.position
        .copy(frame.position)
        .addScaledVector(up, -(frame.scale * BOTTLE_LENGTH) / 2 + 0.01);
      floor.quaternion.copy(s.display.facing);
      floor.rotateX(-Math.PI / 2);
      floor.scale.setScalar(Math.max(0.0001, frame.scale * 0.46 * 3.2));
    }
    // the studio light comes up on the bottle as it arrives, from the viewer's side
    const right = scratch.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const toCamera = scratch.toCamera.set(0, 0, 1).applyQuaternion(cam.quaternion);
    // The studio lights count only while the place is a picture (see freeze): a light in the scene costs every
    // pixel of every material that is drawn, and the place is not to pay for a bottle that is not out. They come
    // up from nothing at the hand-over, so there is no step in the bottle's light there.
    const lit = s.frozen ? frame.rise * frame.opacity * ramp(HANDOVER[plan.mode], s.p) : 0;
    if (keyLightRef.current) {
      keyLightRef.current.intensity = 32 * lit;
      keyLightRef.current.position
        .copy(frame.position)
        .addScaledVector(right, -3 * frame.scale)
        .addScaledVector(up, 4 * frame.scale)
        .addScaledVector(toCamera, 5 * frame.scale);
      keyLightRef.current.target.position.copy(frame.position);
      keyLightRef.current.target.updateMatrixWorld();
    }
    if (rimLightRef.current) {
      rimLightRef.current.intensity = 26 * lit * frame.scale;
      rimLightRef.current.position
        .copy(frame.position)
        .addScaledVector(right, 2.4 * frame.scale)
        .addScaledVector(up, 1.2 * frame.scale)
        .addScaledVector(toCamera, -2.6 * frame.scale);
    }

    // ---- the place as a picture ----
    const handover = HANDOVER[plan.mode];
    const wanted = target === 1 ? s.p >= handover : s.p > handover;
    const around = {
      place: storageRef.current,
      behind: backdropRef.current,
      lights: [keyLightRef.current, rimLightRef.current],
      origin: plan.origin.position,
    };
    if (wanted && !s.frozen) freeze(state, s, g, around);
    else if (!wanted && s.frozen) thaw(state, s, around);
    else if (
      s.frozen &&
      s.still &&
      (s.still.width !== canvas.width || s.still.height !== canvas.height)
    )
      freeze(state, s, g, around); // the view changed size: the same place, drawn again at the new size
    if (s.still) {
      s.still.style.opacity = String(1 - 0.62 * frame.dim);
      s.still.style.transform = `scale(${1 - 0.035 * frame.dim})`;
    }
    const veilPlane = veilMesh.current;
    if (veilPlane) {
      const q = depth * 1.15;
      const h = 2 * q * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
      veilPlane.position.copy(cam.position).addScaledVector(toCamera, -q);
      veilPlane.quaternion.copy(cam.quaternion);
      veilPlane.scale.set(
        h * (state.size.width / Math.max(1, state.size.height)) * 1.3,
        h * 1.3,
        1,
      );
    }

    shadeHero(
      kit,
      0.8 * (1 - frame.slide) * frame.opacity,
      0.8 * frame.rise * frame.rise * frame.opacity,
      s.veiled ? 0.8 * frame.dim : 0,
    );

    const settling = target === 1 ? s.p < 1 : s.p > goal;
    // (held on its way home by a test: keep looking, so that letting go is noticed)
    if (settling || s.spin !== 0 || (target === 0 && goal > 0)) state.invalidate();

    if (target === 1 && s.p >= 1 && !s.arrived) {
      s.arrived = true;
      // where it stands on the screen (px: centre x, top y, bottom y), the same for every place and camera angle
      const half = (frame.scale * BOTTLE_LENGTH) / 2;
      const px = (v: THREE.Vector3) => {
        v.project(cam);
        return [((v.x + 1) / 2) * state.size.width, ((1 - v.y) / 2) * state.size.height] as const;
      };
      const [cx, top] = px(scratch.a.copy(frame.position).addScaledVector(up, half));
      const [, bottom] = px(scratch.a.copy(frame.position).addScaledVector(up, -half));
      mark(canvas, "showcaseBox", [cx, top, bottom].map((n) => n.toFixed(1)).join(","));
      onArrived(run);
    }
    if (target === 0 && s.p <= 0 && !s.returned) {
      s.returned = true;
      measureHandOff(state, g, plan, s.stillView);
      onReturned(run);
    }
  });

  return (
    <>
      <mesh
        ref={veilMesh}
        geometry={kit.veilGeometry}
        material={kit.veil}
        renderOrder={5}
        raycast={noRaycast}
      />
      <mesh
        ref={floorMesh}
        geometry={kit.floorGeometry}
        material={kit.floor}
        renderOrder={5}
        raycast={noRaycast}
      />
      {resting && (
        <mesh
          ref={contactMesh}
          geometry={kit.contactGeometry}
          material={kit.contact}
          renderOrder={1}
          raycast={noRaycast}
        />
      )}
      <group ref={hero} onClick={(e) => e.stopPropagation()}>
        <group position={[0, -BOTTLE_LENGTH / 2, 0]}>
          <mesh geometry={geometry.liquid} material={kit.liquid} renderOrder={6} />
          <mesh geometry={geometry.paper} material={kit.paper} renderOrder={7} />
          <mesh geometry={wraps.front} material={kit.front} renderOrder={8} />
          <mesh geometry={wraps.back} material={kit.back} renderOrder={8} />
          <mesh geometry={geometry.cap} material={kit.foil} renderOrder={8} />
          <mesh geometry={geometry.body} material={kit.glass} renderOrder={9} />
        </group>
      </group>
    </>
  );
}

const scratch = {
  a: new THREE.Vector3(),
  up: new THREE.Vector3(),
  right: new THREE.Vector3(),
  toCamera: new THREE.Vector3(),
  now: new THREE.Matrix4(),
  home: new THREE.Matrix4(),
};

/** What surrounds the bottle that is out: the live place, the element its picture goes in, the studio lights. */
interface Around {
  place: THREE.Group | null;
  behind: HTMLDivElement | null;
  lights: Array<THREE.Light | null>;
  origin: readonly [number, number, number];
}

/** Draws the place alone and puts that picture behind the canvas; from then on the place is not drawn. */
function freeze(
  state: RootState,
  s: Live,
  hero: THREE.Group,
  { place, behind, lights, origin }: Around,
) {
  if (s.removal !== null) cancelAnimationFrame(s.removal);
  s.removal = null;
  if (place) place.visible = true;
  const still = takeStill(state, hero, lights);
  s.frozen = true;
  if (!still || !behind) {
    s.veiled = true; // the live place stays, behind a veil
    for (const l of lights) if (l) l.visible = true;
    return;
  }
  s.veiled = false;
  // from here on only the bottle is drawn: its studio lights join the scene
  for (const l of lights) if (l) l.visible = true;
  // the point the picture steps back from: where the bottle was
  const at = scratch.a.set(...origin).project(state.camera);
  still.canvas.style.transformOrigin = `${((at.x + 1) / 2) * 100}% ${((1 - at.y) / 2) * 100}%`;
  behind.replaceChildren(still.canvas);
  s.still = still.canvas;
  s.stillView = still.view;
  if (place) place.visible = false;
  mark(state.gl.domElement, "still", `${still.canvas.width}x${still.canvas.height}`);
  mark(state.gl.domElement, "stillView", still.view.elements.join(","));
}

/** The live place takes over again; the picture goes two frames later, once the place has really been drawn. */
function thaw(state: RootState, s: Live, { place, behind, lights }: Around) {
  if (place) place.visible = true;
  // the place is drawn again: the studio lights leave the scene (they are dark by now)
  for (const l of lights) if (l) l.visible = false;
  s.frozen = false;
  s.veiled = false;
  const gone = s.still;
  s.still = null;
  if (!gone || !behind) return;
  s.removal = requestAnimationFrame(() => {
    s.removal = requestAnimationFrame(() => {
      s.removal = null;
      if (gone.parentElement === behind) gone.remove();
      mark(state.gl.domElement, "still", null);
    });
  });
  state.invalidate();
}

/**
 * Draws the place without the bottle that is out (and without its lights) and copies the picture into a 2D canvas.
 * Everything is put back as it was. Null when no picture could be taken: the live place then stays.
 */
function takeStill(
  { gl, scene, camera }: RootState,
  hero: THREE.Object3D,
  lights: Array<THREE.Light | null>,
): { canvas: HTMLCanvasElement; view: THREE.Matrix4 } | null {
  const was = { hero: hero.visible, lights: lights.map((l) => l?.visible ?? false) };
  try {
    hero.visible = false;
    // the place is drawn exactly as it is drawn live: without the bottle and without its lights
    for (const l of lights) if (l) l.visible = false;
    camera.updateMatrixWorld();
    gl.render(scene, camera);
    const still = document.createElement("canvas");
    still.style.cssText =
      "display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;will-change:opacity,transform";
    still.width = gl.domElement.width;
    still.height = gl.domElement.height;
    const ctx = still.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(gl.domElement, 0, 0);
    return {
      canvas: still,
      view: new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    };
  } catch {
    return null;
  } finally {
    hero.visible = was.hero;
    lights.forEach((l, i) => {
      if (l) l.visible = was.lights[i]!;
    });
  }
}

/**
 * How far the bottle is, as it lands, from where the storageRef view draws it: in space (the largest difference
 * between the two matrices) and on the screen against the picture of the place (px). Both should be nothing.
 */
function measureHandOff(
  { gl, camera, size }: RootState,
  hero: THREE.Group,
  plan: ExtractionPlan,
  stillView: THREE.Matrix4 | null,
) {
  hero.updateMatrixWorld(true);
  const child = hero.children[0];
  let pose: number;
  if (plan.origin.lie === "token")
    // a counter has no pose of a bottle to come back to: it is back when it is where the counter is
    pose = hero.position.distanceTo(scratch.a.set(...plan.origin.position));
  else {
    // the bottle's model as the film left it, against the storageRef view's own matrix for that spot
    const now = (child ?? hero).matrixWorld.elements;
    const home = poseMatrix(plan.origin, scratch.home).elements;
    pose = Math.max(...now.map((v, i) => Math.abs(v - home[i]!)));
  }
  mark(gl.domElement, "handoffPose", pose.toExponential(2));
  camera.updateMatrixWorld();
  const [x, y, z] = plan.origin.position;
  const seen = scratch.a.set(x, y, z).project(camera).clone();
  mark(
    gl.domElement,
    "handoffSpot",
    `${(((seen.x + 1) / 2) * size.width).toFixed(1)},${(((1 - seen.y) / 2) * size.height).toFixed(1)}`,
  );
  if (stillView) {
    // the spot as the picture of the place showed it, and as the camera sees it now: the same pixel
    const then = scratch.a.set(x, y, z).applyMatrix4(stillView);
    const drift = Math.hypot(
      ((seen.x - then.x) / 2) * size.width,
      ((seen.y - then.y) / 2) * size.height,
    );
    mark(gl.domElement, "handoffDrift", drift.toFixed(2));
  }
}

/**
 * Compiles the shaders the bottle on display will use while nothing is happening, so the first frame of the first
 * inspection does not stall on them. Releases what it made when the scene closes.
 */
export function usePrewarm(
  kit: HeroKit,
  keyLightRef: React.RefObject<THREE.SpotLight | null>,
  rimLightRef: React.RefObject<THREE.PointLight | null>,
) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    let cancelled = false;
    const set = prewarmSet(kit);
    const canvas = gl.domElement;
    const run = () => {
      if (cancelled) return;
      // a label drawn and thrown away: the fonts a label is set in are fetched now, not when the first bottle is
      // taken out (a canvas does not wait for fonts by itself)
      const fonts = makeLabelTexture(
        { producer: "", name: "", year: null, place: "", type: "red" },
        1,
      )
        .then((t) => t.dispose())
        .catch(() => undefined);
      // The bottle is drawn under two sets of lights: the place's own while the place is live (leaving and
      // landing), and with its studio lights once the place is a picture. A shader is compiled for the lights
      // that are in the scene, so both are prepared. (What is compiled for is decided as compileAsync is called;
      // the lights are out of the scene again before anything is drawn.)
      const lights = [keyLightRef.current, rimLightRef.current];
      const plain = gl.compileAsync(set.group, camera, scene).catch(() => undefined);
      for (const l of lights) if (l) l.visible = true;
      const lit = gl.compileAsync(set.group, camera, scene).catch(() => undefined);
      for (const l of lights) if (l) l.visible = false;
      void Promise.all([fonts, plain, lit]).finally(() => {
        if (!cancelled) mark(canvas, "prewarmed", String(gl.info.programs?.length ?? 0));
      });
    };
    const idle =
      window.requestIdleCallback?.(run, { timeout: 1500 }) ?? window.setTimeout(run, 600);
    return () => {
      cancelled = true;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      set.dispose();
      mark(canvas, "prewarmed", null);
    };
  }, [gl, scene, camera, kit, keyLightRef, rimLightRef]);
}

// ---- What the storage view is handed to take a bottle out -----------------------------------------------------------

/** Everything the 3D view needs to show a bottle out of its place. The decisions are made outside it. */
export interface InspectionProps {
  /** Where the inspection stands (showcase-machine.ts). */
  state: ShowcaseState;
  /** What is printed on the bottle that is out. */
  label: LabelSpec | null;
  layout: InspectionLayout;
  /** A status bar or a notch over the top of the picture, in px. */
  safeTop?: number | undefined;
  /** The element behind the 3D canvas that holds the picture of the place while a bottle is looked at. */
  backdrop: React.RefObject<HTMLDivElement | null>;
  veil?: string | undefined;
  onArrived: (run: number) => void;
  onReturned: (run: number) => void;
  /** A tap beside the bottle. */
  onDismiss: () => void;
  /** The bottle that is out is no longer in the place (the place changed under it). */
  onGone: () => void;
}

/**
 * Inside the 3D view: the studio lights for the bottle on display, the bottle's own kit, made once and warmed up,
 * and the bottle itself while one is out.
 *
 * THE LIGHTS ARE IN THE SCENE ONLY WHILE THE PLACE IS A PICTURE. A light costs every pixel of everything that is
 * drawn, so while the place is live (always, when no bottle is out) they are not part of it, and the place draws
 * exactly as it did before there was a showcase. Once the place stands behind the bottle as a picture, only the
 * bottle is drawn, and the lights join. The place's own shaders never see them, so nothing of the place is
 * compiled again; the bottle's shaders are prepared for both (usePrewarm).
 */
export function Inspection({
  inspection,
  model,
  placed,
  level,
  storage,
  reducedMotion,
  onDrag,
}: {
  inspection: InspectionProps;
  model: RenderModel;
  placed: readonly PlacedBottle[];
  level: Quality;
  storage: React.RefObject<THREE.Group | null>;
  reducedMotion: boolean;
  onDrag: (moved: boolean) => void;
}) {
  const keyLight = useRef<THREE.SpotLight>(null);
  const rimLight = useRef<THREE.PointLight>(null);
  const kit = useMemo(() => {
    const owned = new Owned();
    return { owned, parts: buildHeroKit(owned) };
  }, []);
  useEffect(() => () => kit.owned.dispose(), [kit]);
  usePrewarm(kit.parts, keyLight, rimLight);

  const { state } = inspection;
  const bottle =
    state.bottleId === null ? null : (placed.find((b) => b.id === state.bottleId) ?? null);
  // the way out is decided when the bottle leaves, and stays that way until it is back
  const [planned, setPlanned] = useState<{ run: number; plan: ExtractionPlan } | null>(null);
  if (bottle && state.phase !== "idle" && planned?.run !== state.run)
    setPlanned({ run: state.run, plan: planExtraction(model, bottle, placed) });
  const gone = state.phase !== "idle" && bottle === null;
  const { onGone } = inspection;
  useEffect(() => {
    if (gone) onGone();
  }, [gone, onGone]);

  return (
    <>
      <spotLight
        ref={keyLight}
        visible={false}
        intensity={0}
        angle={0.5}
        penumbra={0.9}
        color="#fff2df"
        distance={60}
        decay={1.5}
      />
      <pointLight
        ref={rimLight}
        visible={false}
        intensity={0}
        color="#e6eeff"
        distance={30}
        decay={1.8}
      />
      {bottle && state.phase !== "idle" && planned?.run === state.run && (
        <ShowcaseHero
          key={state.run}
          bottle={bottle}
          plan={planned.plan}
          model={model}
          kit={kit.parts}
          level={level}
          phase={state.phase}
          run={state.run}
          label={inspection.label}
          layout={inspection.layout}
          safeTop={inspection.safeTop ?? 0}
          reducedMotion={reducedMotion}
          storageRef={storage}
          backdropRef={inspection.backdrop}
          keyLightRef={keyLight}
          rimLightRef={rimLight}
          veil={inspection.veil ?? "#f0ebe0"}
          onArrived={inspection.onArrived}
          onReturned={inspection.onReturned}
          onDrag={onDrag}
        />
      )}
    </>
  );
}

/** Whether a bottle is taken off the storage view while it is out (a counter stays: it is not the bottle). */
export const hidesInstance = (bottle: PlacedBottle | null): boolean =>
  bottle !== null && bottle.pose.lie !== "token";
