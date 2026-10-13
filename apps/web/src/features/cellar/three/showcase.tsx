"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  BOTTLE_LENGTH,
  FOIL,
  GLASS,
  RACK_DEPTH,
  SHAPES,
  SLIDE_OUT,
  lathePoints,
  showcasePhases,
  showcaseSpot,
  slotPosition,
  type ShowcaseLayout,
} from "./layout";
import { LABEL_ASPECT, makeLabelTexture, makeShadowTexture } from "./label-texture";
import type { SceneBottle, ShownBottle } from "./types";

/** Matches the lying pose of the bottles in the rack (necks a hair up), so the hand-over is seamless. */
const TILT = 0.04;
const OPEN_SECONDS = 1.4;
const HOME_SECONDS = 0.85;
const AWAY_SECONDS = 0.5;

interface Scratch {
  right: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  display: THREE.Vector3;
  out: THREE.Vector3;
  pos: THREE.Vector3;
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
  /** CSS colour the rack fades towards while a bottle is on display. */
  veil: string;
  reducedMotion: boolean;
  onGone: () => void;
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
  veil,
  reducedMotion,
  onGone,
  onDrag,
}: ShowcaseProps) {
  const { camera, size, gl, invalidate } = useThree();
  const hero = useRef<THREE.Group>(null);
  const veilMesh = useRef<THREE.Mesh>(null);
  const shadowMesh = useRef<THREE.Mesh>(null);
  const live = useRef({ p: 0, away: 0, yaw: 0, spin: 0, clock: 0, finished: false });
  const [label, setLabel] = useState<THREE.Texture | null>(null);

  const { bottle } = shown;
  // A straightened photo of the real label has its own proportions; the wrap follows them.
  const labelAspect = (label?.userData as { aspect?: number } | undefined)?.aspect ?? LABEL_ASPECT;
  const spec = SHAPES[bottle.shape];

  // ---- What it is made of ------------------------------------------------------------------------------------
  const geometry = useMemo(() => {
    const body = new THREE.LatheGeometry(
      lathePoints(bottle.shape).map(([r, y]) => new THREE.Vector2(r, y)),
      72,
    );
    const from = 0.16 * BOTTLE_LENGTH;
    const to = Math.min(spec.bodyEnd - 0.04, 0.48) * BOTTLE_LENGTH;
    const radius = spec.radius + 0.008;
    // The label wraps just far enough round the glass to keep the picture's proportions.
    const arc = Math.min(2.6, (labelAspect * (to - from)) / radius);
    const wrap = (thetaStart: number, thetaLength: number) => {
      const g = new THREE.CylinderGeometry(
        radius,
        radius,
        to - from,
        48,
        1,
        true,
        thetaStart,
        thetaLength,
      );
      g.translate(0, (from + to) / 2, 0);
      return g;
    };
    const front = wrap(-arc / 2, arc);
    const back = wrap(Math.PI - 0.55, 1.1);
    const capFrom = 0.865 * BOTTLE_LENGTH;
    const cap = new THREE.CylinderGeometry(
      spec.neckRadius * 1.12,
      spec.neckRadius * 1.12,
      BOTTLE_LENGTH - capFrom - 0.012,
      32,
    );
    cap.translate(0, capFrom + (BOTTLE_LENGTH - capFrom - 0.012) / 2, 0);
    return { body, front, back, cap };
  }, [bottle.shape, spec, labelAspect]);

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
      invalidate();
    });
    return () => {
      alive = false;
      made?.dispose();
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
    const onUp = () => {
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
      display: new THREE.Vector3(),
      out: new THREE.Vector3(),
      pos: new THREE.Vector3(),
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
      const target = open ? 1 : 0;
      if (reducedMotion) s.p = target;
      else {
        const step = delta / (open ? OPEN_SECONDS : HOME_SECONDS);
        s.p = s.p < target ? Math.min(target, s.p + step) : Math.max(target, s.p - step);
      }
    } else s.away = reducedMotion ? 1 : Math.min(1, s.away + delta / AWAY_SECONDS);

    const { slide, rise, glide } = showcasePhases(s.p);
    const current = bottles.find((b) => b.id === bottle.id) ?? bottle;
    const [sx, sy, sz] = slotPosition(current.row, current.col, rows, cols);

    // Where the camera is looking: the display spot is worked out from it, so it holds however it was turned.
    camera.updateMatrixWorld();
    const cam = camera as THREE.PerspectiveCamera;
    const dist = cam.position.length() || 10;
    const d = dist * 0.5;
    const visibleH = 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const visibleW = visibleH * (size.width / Math.max(1, size.height));
    const spot = showcaseSpot(layout);
    scratch.right.setFromMatrixColumn(cam.matrixWorld, 0);
    scratch.up.setFromMatrixColumn(cam.matrixWorld, 1);
    scratch.forward.setFromMatrixColumn(cam.matrixWorld, 2).negate();
    scratch.display
      .copy(cam.position)
      .addScaledVector(scratch.forward, d)
      .addScaledVector(scratch.right, spot.x * visibleW)
      .addScaledVector(scratch.up, spot.y * visibleH);
    const displayScale = (spot.fill * visibleH) / BOTTLE_LENGTH;

    scratch.out.set(sx, sy, sz + SLIDE_OUT * slide);
    scratch.pos.lerpVectors(scratch.out, scratch.display, glide);
    let scale = 1 + (displayScale - 1) * glide;
    if (s.away > 0) {
      scale *= 1 - s.away * s.away;
      scratch.pos.y += s.away * 0.5;
    }

    // Standing up, with the label turned to the camera, a little give while it waits, and your own turning.
    const sway = reducedMotion ? 0 : Math.sin(s.clock * 0.9) * 0.09 * rise;
    s.yaw += s.spin * delta;
    s.spin *= Math.exp(-3.2 * delta);
    if (Math.abs(s.spin) < 0.01) s.spin = 0;
    if (!open) s.yaw *= Math.exp(-5 * delta);
    const face = Math.atan2(cam.position.x - scratch.pos.x, cam.position.z - scratch.pos.z);
    g.position.copy(scratch.pos);
    g.scale.setScalar(Math.max(0.0001, scale));
    g.rotation.order = "YXZ";
    g.rotation.set((Math.PI / 2 - TILT) * (1 - rise), (face + s.yaw + sway) * rise, 0);

    // A pool of shadow under the standing bottle.
    const shadow = shadowMesh.current;
    if (shadow) {
      shadow.position.set(
        scratch.pos.x,
        scratch.pos.y - (scale * BOTTLE_LENGTH) / 2 + 0.01,
        scratch.pos.z,
      );
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
      (veilPlane.material as THREE.MeshBasicMaterial).opacity = 0.8 * glide * (1 - s.away);
    }

    const settling = leavingForGood ? s.away < 1 : open ? s.p < 1 : s.p > 0;
    const idle = open && !reducedMotion && s.p >= 1;
    if (settling || idle || s.spin !== 0 || (!open && Math.abs(s.yaw) > 0.002)) invalidate();

    if (!open && !s.finished && (leavingForGood ? s.away >= 1 : s.p <= 0)) {
      s.finished = true;
      onGone();
    }
  });

  return (
    <>
      <mesh ref={veilMesh} renderOrder={5}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={veil} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={shadowMesh} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial map={shadowTexture} transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={hero} onClick={(e) => e.stopPropagation()}>
        <group position={[0, -BOTTLE_LENGTH / 2, 0]}>
          <mesh geometry={geometry.body}>
            <meshPhysicalMaterial
              color={GLASS[bottle.type]}
              roughness={0.1}
              clearcoat={1}
              clearcoatRoughness={0.05}
            />
          </mesh>
          <mesh geometry={geometry.front}>
            <meshStandardMaterial
              key={label ? "printed" : "plain"}
              map={label}
              color={label ? "#ffffff" : "#e8dcc2"}
              roughness={0.8}
            />
          </mesh>
          <mesh geometry={geometry.back}>
            <meshStandardMaterial color="#e3d6bb" roughness={0.85} />
          </mesh>
          <mesh geometry={geometry.cap}>
            <meshStandardMaterial color={FOIL[bottle.type]} roughness={0.3} metalness={0.6} />
          </mesh>
        </group>
      </group>
    </>
  );
}
