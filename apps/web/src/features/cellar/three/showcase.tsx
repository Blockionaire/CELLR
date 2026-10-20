"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  BOTTLE_LENGTH,
  FOIL,
  GLASS,
  GLASS_CLEAR,
  GLASS_TINT,
  LIQUID,
  RACK_DEPTH,
  SHAPES,
  SHOWCASE_DEPTH,
  SLIDE_OUT,
  SLOT,
  capsulePoints,
  lathePoints,
  liquidPoints,
  showcaseFrame,
  showcasePhases,
  slotPosition,
  type ShowcaseLayout,
} from "./layout";
import {
  LABEL_ASPECT,
  makeBackLabelTexture,
  makeLabelTexture,
  makeShadowTexture,
} from "./label-texture";
import { contactShadowTexture } from "./materials";
import { BOTTLE_PIVOT, RACK_ROTATION, rackMatrix } from "./pose";
import type { SceneBottle, ShownBottle } from "./types";

/**
 * How far the bottle is, as it lands, from where the rack will draw it: in the world (largest matrix difference)
 * and on screen against the still of the rack (px). Both should be zero; tests read them off the canvas.
 */
function measureHandOff(
  hero: THREE.Group,
  bottle: SceneBottle,
  rows: number,
  cols: number,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  size: { width: number; height: number },
) {
  hero.updateMatrixWorld(true);
  const now = hero.matrixWorld.clone().multiply(BOTTLE_PIVOT).elements;
  const rack = rackMatrix(bottle.row, bottle.col, rows, cols).elements;
  const pose = Math.max(...now.map((v, i) => Math.abs(v - rack[i]!)));
  canvas.dataset.handoffPose = pose.toExponential(2);
  const still = canvas.dataset.stillView?.split(",").map(Number);
  if (still?.length === 16) {
    // The slot as the still of the rack shows it, and as the camera sees it now: these must be the same pixel.
    const [x, y, z] = slotPosition(bottle.row, bottle.col, rows, cols);
    const then = new THREE.Vector3(x, y, z).applyMatrix4(new THREE.Matrix4().fromArray(still));
    camera.updateMatrixWorld();
    const now = new THREE.Vector3(x, y, z).project(camera);
    const dx = ((now.x - then.x) / 2) * size.width;
    const dy = ((now.y - then.y) / 2) * size.height;
    canvas.dataset.handoffDrift = Math.hypot(dx, dy).toFixed(2);
    // where the slot is on the screen (px), so a test can compare the pixels there before and after the hand-over
    canvas.dataset.handoffSlot = `${(((now.x + 1) / 2) * size.width).toFixed(1)},${(((1 - now.y) / 2) * size.height).toFixed(1)}`;
  }
}

const UPRIGHT = new THREE.Vector3();

/** A test-only pause on the way home (window.__cellrHoldReturn = progress); 0 in normal use. */
const heldReturn = () => (globalThis as { __cellrHoldReturn?: number }).__cellrHoldReturn ?? 0;

/**
 * How many shader programs exist once this frame is drawn (compiling happens while drawing): tests compare it with
 * the count before the tap, which should be the same (see Prewarm).
 */
function noteProgramsAfterThisFrame(gl: THREE.WebGLRenderer) {
  requestAnimationFrame(() => {
    gl.domElement.dataset.programs = String(gl.info.programs?.length ?? 0);
  });
}

/** The two lights the bottle on display is lit by. */
export interface Studio {
  keyLightRef: React.RefObject<THREE.SpotLight | null>;
  rimLightRef: React.RefObject<THREE.PointLight | null>;
}

/** Where the bottle on display stands on the screen (px from the view's top-left: centre x, top y, bottom y). */
function measureShowcase(
  pos: THREE.Vector3,
  up: THREE.Vector3,
  scale: number,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  size: { width: number; height: number },
) {
  const half = (scale * BOTTLE_LENGTH) / 2;
  const toPx = (v: THREE.Vector3) => {
    const p = v.project(camera);
    return [((p.x + 1) / 2) * size.width, ((1 - p.y) / 2) * size.height] as const;
  };
  const [cx, top] = toPx(pos.clone().addScaledVector(up, half));
  const [, bottom] = toPx(pos.clone().addScaledVector(up, -half));
  canvas.dataset.showcaseBox = [cx, top, bottom].map((n) => n.toFixed(1)).join(",");
}

/** The rack's own bottle materials (see ShapeGroup in scene.tsx): the bottle on display turns into exactly these. */
const RACK_LOOK = {
  glassRoughness: 0.05,
  glassCoatRoughness: 0.03,
  glassEnv: 1.35,
  label: "#e8dcc2",
  labelRoughness: 0.85,
  foilRoughness: 0.32,
  foilMetalness: 0.75,
  foilEnv: 1.1,
  shadowOpacity: 0.85,
};
const OPEN_SECONDS = 1.4;
const HOME_SECONDS = 0.85;
const AWAY_SECONDS = 0.5;
/** Progress at which the bottle, going home, lies in front of its slot again (the slide in starts below 0.4). */
const LANDING = 0.4;

interface Scratch {
  right: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  toCamera: THREE.Vector3;
  side: THREE.Vector3;
  display: THREE.Vector3;
  out: THREE.Vector3;
  pos: THREE.Vector3;
  basis: THREE.Matrix4;
  facing: THREE.Quaternion;
  turn: THREE.Quaternion;
  pose: THREE.Quaternion;
  axisY: THREE.Vector3;
  rackGlass: THREE.Color;
  tint: THREE.Color;
}

interface ShowcaseProps {
  shown: ShownBottle;
  /** The bottles as they are right now: the shown bottle's slot may have changed since it came out. */
  bottles: SceneBottle[];
  rows: number;
  cols: number;
  /** true = on display, false = on its way home (or away, see `exit`). */
  open: boolean;
  /** "home": slides back into its slot. "gone": it has been opened, so it simply fades away. */
  exit: "home" | "gone";
  layout: ShowcaseLayout;
  /** The phone's status-bar inset (px): the bottle stands below it. */
  safeTop: number;
  /** Thickness of the board the bottle lies on in the rack (its contact shadow sits on it). */
  board: number;
  /** CSS colour the rack fades towards while a bottle is on display. */
  veil: string;
  /** false once a still of the rack stands behind the bottle: no veil is needed then. */
  useVeil: boolean;
  reducedMotion: boolean;
  onGone: () => void;
  /** On the way home, the bottle is lying just in front of its slot: the live rack can take over from the still. */
  onLanding: () => void;
  /** On the way out, the bottle has slid clear of its slot: the still of the rack can take over from the live one. */
  onClear: () => void;
  /** The studio lights for the bottle on display (the scene's; see Studio in scene.tsx). */
  studio: Studio;
  /** Tells the scene whether the last press was a drag (turning the bottle), so it is not read as a tap. */
  onDrag: (moved: boolean) => void;
}

/**
 * The bottle on display. It leaves its slot along its own axis, stands up, turns its label to you and
 * settles beside the details; the rest of the rack fades back. Drag to turn it round. All of it is one
 * number (`progress`) run through `showcasePhases`, so going home is the same film played backwards.
 */
export function Showcase({
  shown,
  bottles,
  rows,
  cols,
  open,
  exit,
  layout,
  safeTop,
  board,
  veil,
  useVeil,
  reducedMotion,
  onGone,
  onLanding,
  onClear,
  studio,
  onDrag,
}: ShowcaseProps) {
  const { camera, size, gl, invalidate } = useThree();
  const hero = useRef<THREE.Group>(null);
  const veilMesh = useRef<THREE.Mesh>(null);
  const shadowMesh = useRef<THREE.Mesh>(null);
  const contactMesh = useRef<THREE.Mesh>(null);
  const glassMesh = useRef<THREE.Mesh>(null);
  const frontPrint = useRef<THREE.MeshStandardMaterial>(null);
  const backPrint = useRef<THREE.MeshStandardMaterial>(null);
  const live = useRef({
    p: 0,
    away: 0,
    yaw: 0,
    spin: 0,
    clock: 0,
    finished: false,
    shown: false,
    landed: false,
    moved: false,
    firstDone: false,
    cleared: false,
  });
  const [label, setLabel] = useState<THREE.Texture | null>(null);
  const [backLabel, setBackLabel] = useState<THREE.Texture | null>(null);
  // Lent by the scene (always there, at 0 when no bottle is out): adding lights would make every material in the
  // scene switch shader programs on the frame a bottle is picked.
  const { keyLightRef, rimLightRef } = studio;
  useEffect(
    () => () => {
      if (keyLightRef.current) keyLightRef.current.intensity = 0;
      if (rimLightRef.current) rimLightRef.current.intensity = 0;
    },
    [keyLightRef, rimLightRef],
  );

  const { bottle } = shown;
  // A straightened photo of the real label has its own proportions; the wrap follows them.
  const labelAspect = (label?.userData as { aspect?: number } | undefined)?.aspect ?? LABEL_ASPECT;
  const backAspect = (backLabel?.userData as { aspect?: number } | undefined)?.aspect ?? 0.7;
  const spec = SHAPES[bottle.shape];

  // ---- What it is made of ------------------------------------------------------------------------------------
  const geometry = useMemo(() => {
    const lathe = (points: Array<[number, number]>, segments: number) =>
      new THREE.LatheGeometry(
        points.map(([r, y]) => new THREE.Vector2(r, y)),
        segments,
      );
    const body = lathe(lathePoints(bottle.shape), 96);
    const liquid = lathe(liquidPoints(bottle.shape), 48);
    const cap = lathe(capsulePoints(bottle.shape), 64);
    const from = 0.16 * BOTTLE_LENGTH;
    const to = Math.min(spec.bodyEnd - 0.04, 0.48) * BOTTLE_LENGTH;
    // The rack's plain paper band, all round (what the bottle wears in the rack), and the printed labels a hair
    // outside it, fading in as the bottle comes out and out as it goes home.
    const band = spec.radius + 0.008;
    const radius = band + 0.004;
    const wrap = (
      thetaStart: number,
      thetaLength: number,
      bottom: number,
      top: number,
      r = radius,
    ) => {
      const g = new THREE.CylinderGeometry(
        r,
        r,
        top - bottom,
        64,
        1,
        true,
        thetaStart,
        thetaLength,
      );
      g.translate(0, (bottom + top) / 2, 0);
      return g;
    };
    const paper = wrap(0, Math.PI * 2, from, to, band);
    // Each label wraps just far enough round the glass to keep its picture's proportions; the back label is a
    // little smaller, as it usually is, and sits right opposite the front.
    const arc = Math.min(2.6, (labelAspect * (to - from)) / radius);
    const front = wrap(-arc / 2, arc, from, to);
    const backHeight = (to - from) * 0.84;
    const backArc = Math.min(2.2, (backAspect * backHeight) / radius);
    const back = wrap(Math.PI - backArc / 2, backArc, from, from + backHeight);
    // The soft shadow the bottle leaves on its board in the rack (the same as the rack's own).
    const contact = new THREE.PlaneGeometry(spec.radius * 2.1, BOTTLE_LENGTH * 0.96);
    contact.rotateX(-Math.PI / 2);
    return { body, liquid, cap, paper, front, back, contact };
  }, [bottle.shape, spec, labelAspect, backAspect]);

  // What the bottle is made of. The glass is tinted and partly see-through, so the wine shows in a clear bottle
  // and a dark one stays dark, as in life; the labels carry a touch of their own light so they stay readable.
  // In the rack it is the rack's bottle exactly (see RACK_LOOK); on display the glass clears to its real tint and the
  // wine shows through. The frame loop moves between the two with the bottle's rise, so the hand-over at either end
  // is the same colour, not a jump.
  const materials = useMemo(
    () => ({
      glass: new THREE.MeshPhysicalMaterial({
        color: GLASS[bottle.type],
        roughness: RACK_LOOK.glassRoughness,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: RACK_LOOK.glassCoatRoughness,
        ior: 1.5,
        specularIntensity: 1,
        envMapIntensity: RACK_LOOK.glassEnv,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      }),
      liquid: new THREE.MeshStandardMaterial({
        color: LIQUID[bottle.type],
        roughness: 0.25,
        envMapIntensity: 0.6,
      }),
      paper: new THREE.MeshStandardMaterial({
        color: RACK_LOOK.label,
        roughness: RACK_LOOK.labelRoughness,
      }),
      foil: new THREE.MeshStandardMaterial({
        color: FOIL[bottle.type],
        roughness: RACK_LOOK.foilRoughness,
        metalness: RACK_LOOK.foilMetalness,
        envMapIntensity: RACK_LOOK.foilEnv,
      }),
      contact: new THREE.MeshBasicMaterial({
        map: contactShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    }),
    [bottle.type],
  );
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  const shadowTexture = useMemo(() => makeShadowTexture(), []);

  // The label is drawn once the fonts are in; until then the glass wears plain paper.
  const spokenLabel = JSON.stringify(shown.label);
  useEffect(() => {
    let alive = true;
    let made: THREE.Texture | null = null;
    makeLabelTexture(JSON.parse(spokenLabel), gl.capabilities.getMaxAnisotropy()).then((t) => {
      if (!alive) return t.dispose();
      made = t;
      setLabel(t);
      // What the bottle actually wears, readable from outside (the tests check a photo really arrived).
      gl.domElement.dataset.frontLabel = (t.userData as { photo?: boolean }).photo
        ? "photo"
        : "drawn";
      invalidate();
    });
    return () => {
      alive = false;
      made?.dispose();
      delete gl.domElement.dataset.frontLabel;
    };
  }, [spokenLabel, gl, invalidate]);
  useEffect(() => {
    let alive = true;
    let made: THREE.Texture | null = null;
    makeBackLabelTexture(JSON.parse(spokenLabel), gl.capabilities.getMaxAnisotropy()).then((t) => {
      if (!alive) return t.dispose();
      made = t;
      setBackLabel(t);
      // What the bottle actually wears, readable from outside (the tests check a photo really arrived).
      gl.domElement.dataset.backLabel = (t.userData as { photo?: boolean }).photo
        ? "photo"
        : "drawn";
      invalidate();
    });
    return () => {
      alive = false;
      made?.dispose();
      delete gl.domElement.dataset.backLabel;
    };
  }, [spokenLabel, gl, invalidate]);
  useEffect(
    () => () => {
      Object.values(geometry).forEach((g) => g.dispose());
      shadowTexture.dispose();
    },
    [geometry, shadowTexture],
  );

  useEffect(() => {
    if (open) live.current.finished = false;
  }, [open]);

  // ---- Turning it with a finger or the mouse -------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const el = gl.domElement;
    const s = live.current;
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
      // Held still before letting go: it stays where it was put, without a last flick.
      if (down && e.timeStamp - lastT > 90) s.spin = 0;
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
  }, [open, gl, invalidate, onDrag]);

  // ---- The film ----------------------------------------------------------------------------------------------------
  // Working vectors, made once and reused every frame.
  const work = useRef<Scratch | null>(null);
  if (work.current === null)
    work.current = {
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      toCamera: new THREE.Vector3(),
      side: new THREE.Vector3(),
      display: new THREE.Vector3(),
      out: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      basis: new THREE.Matrix4(),
      facing: new THREE.Quaternion(),
      turn: new THREE.Quaternion(),
      pose: new THREE.Quaternion(),
      axisY: new THREE.Vector3(0, 1, 0),
      rackGlass: new THREE.Color(),
      tint: new THREE.Color(),
    };

  useFrame((_, rawDelta) => {
    const g = hero.current;
    const scratch = work.current;
    if (!g || !scratch) return;
    const s = live.current;
    const delta = Math.min(rawDelta, 0.1);
    s.clock += delta;

    // Progress.
    const leavingForGood = !open && exit === "gone";
    if (!leavingForGood) {
      // Tests can hold the way home a hair before the hand-over, to compare the last frame with the rack's.
      const target = open ? 1 : heldReturn();
      if (reducedMotion) s.p = target;
      else {
        const step = delta / (open ? OPEN_SECONDS : HOME_SECONDS);
        s.p = s.p < target ? Math.min(target, s.p + step) : Math.max(target, s.p - step);
      }
    } else s.away = reducedMotion ? 1 : Math.min(1, s.away + delta / AWAY_SECONDS);

    if (!s.moved && s.p > 0) {
      s.moved = true;
      performance.mark("cellr:showcase-moving");
    }
    const { slide, rise, glide } = showcasePhases(s.p);
    const current = bottles.find((b) => b.id === bottle.id) ?? bottle;
    const [sx, sy, sz] = slotPosition(current.row, current.col, rows, cols);

    // ---- Where it stands on display: fixed on the screen, whatever way the rack was turned ----------------------
    // The camera does not move while a bottle is out (see Rig), so this is a fixed point in front of it: the spot
    // the free part of the screen leaves (showcaseFrame), at a set depth, as tall as that space allows.
    camera.updateMatrixWorld();
    const cam = camera as THREE.PerspectiveCamera;
    const dist = cam.position.length() || 10;
    // In front of the rack even when zoomed right in (the rack may be drawn live if no still could be taken).
    const d = Math.min(SHOWCASE_DEPTH, Math.max(1, (dist - RACK_DEPTH / 2) * 0.8));
    const visibleH = 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const visibleW = visibleH * (size.width / Math.max(1, size.height));
    const frame = showcaseFrame(layout, size.width, size.height, safeTop);
    scratch.right.setFromMatrixColumn(cam.matrixWorld, 0);
    scratch.up.setFromMatrixColumn(cam.matrixWorld, 1);
    scratch.forward.setFromMatrixColumn(cam.matrixWorld, 2).negate();
    scratch.display
      .copy(cam.position)
      .addScaledVector(scratch.forward, d)
      .addScaledVector(scratch.right, frame.x * visibleW)
      .addScaledVector(scratch.up, frame.y * visibleH);
    const displayScale = (frame.fill * visibleH) / BOTTLE_LENGTH;

    // Upright as the screen sees it, the front label turned straight to the viewer, plus your own turning.
    scratch.toCamera.copy(cam.position).sub(scratch.display).normalize();
    scratch.side.crossVectors(scratch.up, scratch.toCamera).normalize();
    scratch.basis.makeBasis(
      scratch.side,
      UPRIGHT.crossVectors(scratch.toCamera, scratch.side),
      scratch.toCamera,
    );
    scratch.facing.setFromRotationMatrix(scratch.basis);
    s.yaw += s.spin * delta;
    s.spin *= Math.exp(-3.2 * delta);
    if (Math.abs(s.spin) < 0.01) s.spin = 0;
    if (!open) s.yaw *= Math.exp(-5 * delta);
    scratch.turn.setFromAxisAngle(scratch.axisY, s.yaw);
    scratch.facing.multiply(scratch.turn);

    // ---- The way there: out of the slot along its own axis, then up and over -------------------------------------
    // At progress 0 every term below is exactly the rack's pose (RACK_ROTATION, the slot, scale 1): see rackMatrix.
    scratch.out.set(sx, sy, sz + SLIDE_OUT * slide);
    scratch.pos.lerpVectors(scratch.out, scratch.display, glide);
    let scale = 1 + (displayScale - 1) * glide;
    if (s.away > 0) {
      scale *= 1 - s.away * s.away;
      scratch.pos.addScaledVector(scratch.up, s.away * 0.5);
    }
    scratch.pose.slerpQuaternions(RACK_ROTATION, scratch.facing, rise);
    g.position.copy(scratch.pos);
    g.quaternion.copy(scratch.pose);
    g.scale.setScalar(Math.max(0.0001, scale));

    // ---- What it looks like: the rack's bottle at the ends, the real glass, wine and labels on display ---------------
    const glass = glassMesh.current?.material as THREE.MeshPhysicalMaterial | undefined;
    scratch.rackGlass.set(GLASS[bottle.type]);
    scratch.tint.set(GLASS_TINT[bottle.type]);
    if (glass) {
      glass.color.lerpColors(scratch.rackGlass, scratch.tint, rise);
      glass.opacity = 1 - GLASS_CLEAR[bottle.type] * 0.72 * rise;
      glass.roughness = THREE.MathUtils.lerp(RACK_LOOK.glassRoughness, 0.04, rise);
      glass.clearcoatRoughness = THREE.MathUtils.lerp(RACK_LOOK.glassCoatRoughness, 0.02, rise);
      glass.envMapIntensity = THREE.MathUtils.lerp(RACK_LOOK.glassEnv, 1.5, rise);
    }
    for (const print of [frontPrint.current, backPrint.current]) {
      if (!print) continue;
      print.opacity = rise;
      print.emissiveIntensity = 0.16 * rise;
      print.visible = rise > 0.001;
    }
    // The contact shadow on its board: there while it lies in the slot, gone as it slides clear.
    const contact = contactMesh.current;
    if (contact) {
      contact.position.set(sx, sy - SLOT / 2 + board / 2 + 0.006, 0);
      (contact.material as THREE.MeshBasicMaterial).opacity =
        RACK_LOOK.shadowOpacity * (1 - slide) * (1 - s.away);
    }

    // A pool of shadow under the standing bottle, at its foot.
    const shadow = shadowMesh.current;
    if (shadow) {
      shadow.position
        .copy(scratch.pos)
        .addScaledVector(scratch.up, -(scale * BOTTLE_LENGTH) / 2 + 0.01);
      shadow.quaternion.copy(scratch.facing);
      shadow.rotateX(-Math.PI / 2);
      shadow.scale.setScalar(Math.max(0.0001, scale * spec.radius * 4.2));
      (shadow.material as THREE.MeshBasicMaterial).opacity = rise * rise * (1 - s.away);
    }

    // The rack steps back: a veil of the card's colour between you and it.
    const front = dist - RACK_DEPTH / 2 - 0.12;
    const q = Math.max(d * 1.15, front);
    const veilH = 2 * q * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const veilPlane = veilMesh.current;
    if (veilPlane) {
      veilPlane.position.copy(cam.position).addScaledVector(scratch.forward, q);
      veilPlane.quaternion.copy(cam.quaternion);
      veilPlane.scale.set(veilH * (size.width / Math.max(1, size.height)) * 1.3, veilH * 1.3, 1);
      (veilPlane.material as THREE.MeshBasicMaterial).opacity = useVeil
        ? 0.8 * glide * (1 - s.away)
        : 0;
    }

    const settling = leavingForGood ? s.away < 1 : open ? s.p < 1 : s.p > 0;
    // The studio light comes up on the bottle as it arrives and goes down as it leaves; it is placed from the
    // viewer's side (above left, in front), so the bottle is lit the same way from every rack angle.
    const lit = rise * (1 - s.away);
    if (keyLightRef.current) {
      keyLightRef.current.intensity = 70 * lit;
      keyLightRef.current.position
        .copy(scratch.pos)
        .addScaledVector(scratch.right, -3 * scale)
        .addScaledVector(scratch.up, 4 * scale)
        .addScaledVector(scratch.toCamera, 5 * scale);
      keyLightRef.current.target.position.copy(scratch.pos);
      keyLightRef.current.target.updateMatrixWorld();
    }
    if (rimLightRef.current) {
      rimLightRef.current.intensity = 26 * lit * scale;
      rimLightRef.current.position
        .copy(scratch.pos)
        .addScaledVector(scratch.right, 2.4 * scale)
        .addScaledVector(scratch.up, 1.2 * scale)
        .addScaledVector(scratch.toCamera, -2.6 * scale);
    }

    if (!s.firstDone) {
      s.firstDone = true;
      performance.mark("cellr:showcase-first-update");
      noteProgramsAfterThisFrame(gl);
    }
    if (settling || s.spin !== 0 || (!open && Math.abs(s.yaw) > 0.002)) invalidate();

    // Arrived: where it stands on the screen, readable from outside (tests check it is the same every time).
    if (open && s.p >= 1 && !s.shown) {
      s.shown = true;
      measureShowcase(scratch.pos, scratch.up, scale, camera, gl.domElement, size);
    }
    if (!open) s.shown = false;
    // Lying down again in front of its slot (the slide in is about to start): the live rack takes over the still.
    if (!open && !leavingForGood && !s.landed && s.p <= LANDING) {
      s.landed = true;
      onLanding();
    }
    if (open) s.landed = false;
    // Slid clear of its slot on the way out: the still of the rack takes over (the mirror of landing).
    if (open && !s.cleared && s.p >= LANDING) {
      s.cleared = true;
      onClear();
    }
    if (!open) s.cleared = false;

    if (!open && !s.finished && (leavingForGood ? s.away >= 1 : s.p <= 0)) {
      s.finished = true;
      if (!leavingForGood) measureHandOff(g, current, rows, cols, camera, gl.domElement, size);
      onGone();
    }
  });

  return (
    <>
      <mesh ref={veilMesh} renderOrder={5}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={veil} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={shadowMesh} renderOrder={4}>
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial map={shadowTexture} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh
        ref={contactMesh}
        geometry={geometry.contact}
        material={materials.contact}
        renderOrder={1}
        raycast={() => null}
      />
      <group ref={hero} onClick={(e) => e.stopPropagation()}>
        <group position={[0, -BOTTLE_LENGTH / 2, 0]}>
          <mesh geometry={geometry.liquid} material={materials.liquid} renderOrder={1} />
          <mesh geometry={geometry.paper} material={materials.paper} renderOrder={2} />
          <mesh geometry={geometry.front} renderOrder={2}>
            <meshStandardMaterial
              ref={frontPrint}
              key={label ? "printed" : "plain"}
              map={label}
              emissiveMap={label}
              emissive={label ? "#ffffff" : "#000000"}
              emissiveIntensity={0}
              color={label ? "#ffffff" : RACK_LOOK.label}
              roughness={0.72}
              transparent
              opacity={0}
              depthWrite={false}
            />
          </mesh>
          <mesh geometry={geometry.back} renderOrder={2}>
            <meshStandardMaterial
              ref={backPrint}
              key={backLabel ? "printed" : "plain"}
              map={backLabel}
              emissiveMap={backLabel}
              emissive={backLabel ? "#ffffff" : "#000000"}
              emissiveIntensity={0}
              color={backLabel ? "#ffffff" : RACK_LOOK.label}
              roughness={0.75}
              transparent
              opacity={0}
              depthWrite={false}
            />
          </mesh>
          <mesh geometry={geometry.cap} material={materials.foil} renderOrder={2} />
          <mesh
            ref={glassMesh}
            geometry={geometry.body}
            material={materials.glass}
            renderOrder={3}
          />
        </group>
      </group>
    </>
  );
}
