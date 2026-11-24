"use client";

import { Canvas, useFrame, useStore, useThree, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { BottleShape } from "@/ui/bottle-glyph";
import { FOIL, FOV, GLASS } from "../three/layout";
import {
  QUALITY,
  START_AZIMUTH,
  START_ELEVATION,
  aimZoom,
  frameFor,
  sameSpot,
  keepOutside,
  lowerQuality,
  placeBottles,
  qualityFor,
  type PlacedBottle,
  type Placement,
  type Quality,
  type RenderModel,
  type StoredBottle,
} from "./model";
import { AIR, BOTTLE_L, BOTTLE_R, type Pose, type Vec3 } from "./parts";
import type { FreeSpot, SpotMarker } from "../quick-add/spots";
import { Inspection, hidesInstance, type InspectionProps } from "./showcase-hero";
import { isOut } from "./showcase-machine";
import {
  Owned,
  bottleGroups,
  buildAmbience,
  buildBottleKit,
  buildGhostBottle,
  buildGhostMaterial,
  buildStructure,
  GHOST_LIFT,
  ghostRadial,
  markerMatrix,
  poseMatrix,
  type BottleKit,
} from "./resources";

/**
 * A place drawn from its layout (Smart Cellar 3D, sprint 2A): any of the fourteen templates, or the neutral
 * picture of a place whose arrangement is not known. NOT a place from before templates: those are drawn by the
 * existing view (../three/scene.tsx), unchanged, and this component refuses them.
 *
 * It keeps what makes the existing view light on a phone: it draws only when something changes, every bottle of a
 * shape is one instanced mesh, the furniture is a handful of merged meshes, nothing is downloaded, and the
 * sharpness is capped. It steps the level of detail down by itself when frames come slowly.
 *
 * WHAT IT DOES NOT DO YET (sprint 2B): take a bottle out and show it. A tap chooses a bottle and marks it; the
 * caller shows what it is. There is no half-working "take out" here.
 */
export interface TemplateSceneProps {
  model: RenderModel;
  bottles: readonly StoredBottle[];
  /** The level of detail; left out, it is chosen from how much there is to draw and from the device. */
  quality?: Quality | undefined;
  selectedId?: string | null | undefined;
  /** A tap on a bottle (its id), or on nothing (null). */
  onPick?: ((id: string | null) => void) | undefined;
  reducedMotion?: boolean | undefined;
  onReady?: (() => void) | undefined;
  /** The browser took the graphics memory back. */
  onLost?: (() => void) | undefined;
  /** Write what was drawn onto the canvas element (for the gallery's readout and the tests). */
  debug?: boolean | undefined;
  /** Where the bottles lie, when the caller has worked it out already (it needs it too); else worked out here. */
  placement?: Placement | undefined;
  /**
   * Taking a bottle out to look at it (sprint 2B.1). Left out, a tap only chooses a bottle, as before. Given, the
   * view shows the bottle of `inspection.state` out of its place; what may happen and when is decided outside.
   */
  inspection?: InspectionProps | undefined;
  /**
   * A spot a bottle is about to be put on (sprint 4): marked with a ring, nothing more. Its own bottle is not drawn
   * there until the server has said it moved; this is only where it would go.
   */
  target?: { row: number; col: number; index: number } | null | undefined;
  /**
   * Free spots offered to tap (3D Quick Add, sprint 7), each with the pose a bottle put there would have. Given (even
   * empty): a tap chooses a spot, never takes a bottle out; dragging the camera is never a tap. Null: as before.
   */
  spots?: readonly SpotMarker[] | null | undefined;
  onSpot?: ((spot: FreeSpot) => void) | undefined;
  /**
   * A finger tapped a spot on offer that was too small to be sure of: the view came closer instead of choosing it
   * (sprint 10). For a hint such as "tap again"; optional.
   */
  onAim?: (() => void) | undefined;
}

function lowPower(): boolean {
  if (typeof navigator === "undefined") return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (navigator.hardwareConcurrency ?? 8) <= 4 || (memory !== undefined && memory <= 4);
}

export default function TemplateScene({
  model,
  bottles,
  quality,
  selectedId = null,
  onPick,
  reducedMotion = false,
  onReady,
  onLost,
  debug = false,
  placement: given,
  inspection,
  target = null,
  spots = null,
  onSpot,
  onAim,
}: TemplateSceneProps) {
  if (model.renderer === "legacy")
    throw new Error(
      "A place from before templates is drawn by the existing 3D view, not by this one.",
    );
  const worked = useMemo(() => given ?? placeBottles(model, bottles), [given, model, bottles]);
  const placement = worked;
  // The level starts from how much there is to draw; slow frames can only lower it, for as long as this place is up.
  const start = quality ?? qualityFor(placement.placed.length, lowPower());
  const [lowered, setLowered] = useState<{ from: Quality; to: Quality } | null>(null);
  const level = lowered && lowered.from === start ? lowered.to : start;
  const spec = QUALITY[level];
  const dragged = useRef(false);
  // a bottle is out (on display or moving): the camera holds still and a tap does not choose another
  const out = inspection !== undefined && isOut(inspection.state);
  // spots on offer (sprint 7): a tap chooses a spot; bottles stay where they are and are not taken out meanwhile
  const offering = spots !== null && !out;
  const outBottle =
    out && inspection
      ? (placement.placed.find((b) => b.id === inspection.state.bottleId) ?? null)
      : null;
  const hiddenId = hidesInstance(outBottle) ? outBottle!.id : null;
  const storage = useRef<THREE.Group>(null);
  // where the ring of a target goes: the spot itself where spots are places, the next place in the pile in a bin
  const targetPose = useMemo(() => {
    if (!target) return null;
    if (model.built.poseOf) return model.built.poseOf(target.row, target.col, target.index);
    if (model.built.pileOf) {
      const inCell = placement.placed.filter(
        (b) => b.address.row === target.row && b.address.col === target.col,
      ).length;
      return model.built.pileOf(target.row, target.col, inCell);
    }
    return null;
  }, [target, model, placement]);
  // a tap with a finger on a spot too small to be sure of brings the view closer instead (sprint 10)
  const aim = useRef<Aim | null>(null);
  const setAim = useCallback((a: Aim | null) => {
    aim.current = a;
  }, []);
  const onDrag = useCallback((moved: boolean) => {
    dragged.current = moved;
  }, []);
  const leaving = useRef(false);
  useEffect(() => {
    leaving.current = false;
    return () => {
      leaving.current = true;
    };
  }, []);

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, spec.maxDpr]}
      camera={{ fov: FOV, near: 0.1, far: 600 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl, invalidate }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          if (leaving.current) return;
          e.preventDefault();
          gl.domElement.dataset.contextLost = "1";
          onLost?.();
        });
        // A host that keeps this view up through a loss (none does today: they put a notice in its place and mount it
        // anew) gets its picture back: three.js uploads everything again by itself, and nothing is drawn until asked.
        gl.domElement.addEventListener("webglcontextrestored", () => {
          delete gl.domElement.dataset.contextLost;
          invalidate();
        });
        performance.mark("cellr:storage3d-created");
        onReady?.();
      }}
      onPointerMissed={() => {
        if (dragged.current || offering) return;
        // beside the bottle that is out: it goes back. Otherwise: nothing is chosen.
        if (out) inspection.onDismiss();
        else onPick?.(null);
      }}
    >
      <Lighting model={model} />
      <Rig
        model={model}
        reducedMotion={reducedMotion}
        dragged={dragged}
        locked={out}
        onAim={setAim}
      />
      {/* the place itself: not drawn while a picture of it stands in behind the bottle that is out */}
      <group ref={storage}>
        <Structure model={model} level={level} />
        <Bottles
          placed={placement.placed}
          empties={placement.empties}
          model={model}
          level={level}
          selectedId={out ? null : selectedId}
          targetPose={out ? null : targetPose}
          hiddenId={hiddenId}
          onPick={
            out
              ? () => {
                  if (!dragged.current) inspection.onDismiss();
                }
              : offering
                ? undefined
                : onPick
          }
        />
        {offering && spots.length > 0 && (
          <SpotMarkers
            spots={spots}
            placed={placement.placed}
            active={target}
            dragged={dragged}
            aim={aim}
            onSpot={onSpot}
            onAim={onAim}
          />
        )}
      </group>
      {inspection && (
        <Inspection
          inspection={inspection}
          model={model}
          placed={placement.placed}
          level={level}
          storage={storage}
          reducedMotion={reducedMotion}
          onDrag={onDrag}
        />
      )}
      <Pace
        level={level}
        // not while a bottle is out: the place it comes back to must be the place it left, to the pixel
        fixed={quality !== undefined || out}
        onSlow={() => {
          const next = lowerQuality(level);
          if (next) setLowered({ from: start, to: next });
        }}
      />
      {debug && (
        <Readout
          model={model}
          level={level}
          placed={placement.placed}
          stranded={placement.stranded.length}
          spots={offering ? spots : null}
        />
      )}
    </Canvas>
  );
}

// ---- Light ----------------------------------------------------------------------------------------------------------

/** The same studio as the existing view: a procedural room to mirror in the glass, a warm key, a cool rim. */
function Lighting({ model }: { model: RenderModel }) {
  const store = useStore();
  useEffect(() => {
    const { gl, scene, invalidate } = store.getState();
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.65;
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
      room.dispose();
    };
  }, [store]);
  const at = model.built.light ?? [0, 0, 0];
  const size = Math.max(
    model.bounds.max[0] - model.bounds.min[0],
    model.bounds.max[1] - model.bounds.min[1],
  );
  return (
    <>
      <hemisphereLight args={["#fff3e2", "#2b1d16", 0.5]} />
      <directionalLight position={[-7, 10, 12]} intensity={2.1} color="#fff0da" />
      <directionalLight position={[8, 3, -6]} intensity={0.9} color="#dfe8ff" />
      <pointLight position={[6, -3, 9]} intensity={38} color="#ffc394" distance={40} decay={2} />
      {/* The light inside the place: always in the scene (dark when the look has none), so choosing a lit look
          never changes the number of lights, which would send every material to another shader program. */}
      <pointLight
        position={at}
        intensity={model.built.light ? model.look.light.intensity * (6 + size * 1.5) : 0}
        color={model.look.light.color}
        distance={Math.max(6, size * 1.4)}
        decay={1.6}
      />
    </>
  );
}

// ---- Camera ---------------------------------------------------------------------------------------------------------

/**
 * A finger tapped a target at `point` whose nearest neighbour is `gap` px away on the screen. When that is too close to
 * be sure of (`aimZoom`), the view comes closer round the point, from the same direction (a short glide, or at once
 * under reduced motion), and true is returned: the tap chose nothing. False: the tap is taken as aimed.
 */
type Aim = (point: Readonly<Vec3>, gap: number) => boolean;
/** How long the glide of a zoom to aim takes (ms). */
const AIM_MS = 260;

function Rig({
  model,
  reducedMotion,
  dragged,
  locked,
  onAim,
}: {
  model: RenderModel;
  reducedMotion: boolean;
  dragged: React.RefObject<boolean>;
  /** A bottle is out: the camera holds still, so that it comes back to the very view it left. */
  locked: boolean;
  /** Given how the spots on offer may ask for a closer view (null when they may not any more). */
  onAim: (aim: Aim | null) => void;
}) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const aspect = size.width / Math.max(1, size.height);
  // The box by its numbers, not by its object: a new model of the same size (another colour, a light switched on in
  // the Rack Builder) keeps the camera where the person left it; only a change of size frames the place again.
  const boxKey = [...model.bounds.min, ...model.bounds.max].map((n) => n.toFixed(4)).join(",");
  const bounds = useMemo(() => {
    const n = boxKey.split(",").map(Number);
    const min: [number, number, number] = [n[0]!, n[1]!, n[2]!];
    const max: [number, number, number] = [n[3]!, n[4]!, n[5]!];
    return { min, max };
  }, [boxKey]);
  const framing = useMemo(() => frameFor(bounds, aspect), [bounds, aspect]);
  // the camera is placed once per place; a resize only changes how far it may go
  const placedFor = useRef<string | null>(null);
  // a zoom to aim under way: from where, to where, since when (one object, made when the glide is asked for)
  const glide = useRef<{
    from: THREE.Vector3;
    fromTarget: THREE.Vector3;
    to: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
  } | null>(null);

  useLayoutEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.dampingFactor = 0.09;
    c.zoomToCursor = true;
    c.enablePan = true;
    c.screenSpacePanning = true;
    c.minAzimuthAngle = -1.1;
    c.maxAzimuthAngle = 1.1;
    c.minPolarAngle = 0.7;
    c.maxPolarAngle = 1.8;
    c.rotateSpeed = 0.7;
    c.zoomSpeed = 0.8;
    c.panSpeed = 0.9;
    let moved = 0;
    const onStart = () => {
      moved = 0;
      dragged.current = false;
      // a finger on the picture again: the person takes over from a glide under way
      glide.current = null;
    };
    const onChange = () => {
      moved += 1;
      if (moved > 2) dragged.current = true;
      gl.domElement.dataset.distance = c.getDistance().toFixed(2);
      gl.domElement.dataset.azimuth = c.getAzimuthalAngle().toFixed(3);
      invalidate();
    };
    c.addEventListener("start", onStart);
    c.addEventListener("change", onChange);
    controls.current = c;
    return () => {
      c.removeEventListener("start", onStart);
      c.removeEventListener("change", onChange);
      c.dispose();
      controls.current = null;
      placedFor.current = null;
    };
    // (reduced motion is not among what makes the controls: a change of that setting must not put the camera back)
  }, [camera, gl, invalidate, dragged]);

  // no glide after a turn under reduced motion: the view stops where the finger lets go
  useLayoutEffect(() => {
    const c = controls.current;
    if (c) c.enableDamping = !reducedMotion;
  }, [reducedMotion, camera, gl]);

  useLayoutEffect(() => {
    const c = controls.current;
    if (!c) return;
    // never so close that the camera is in the front of the place (sprint 10: a small place on a wide screen was)
    c.minDistance = framing.closest;
    c.maxDistance = framing.distance * 1.8;
    if (placedFor.current !== boxKey) {
      placedFor.current = boxKey;
      const [tx, ty, tz] = framing.target;
      c.target.set(tx, ty, tz);
      camera.position.set(
        tx + framing.distance * Math.sin(START_AZIMUTH) * Math.cos(START_ELEVATION),
        ty + framing.distance * Math.sin(START_ELEVATION),
        tz + framing.distance * Math.cos(START_AZIMUTH) * Math.cos(START_ELEVATION),
      );
      camera.lookAt(tx, ty, tz);
    }
    c.update();
    invalidate();
  }, [framing, boxKey, camera, invalidate]);

  // while a bottle is out the controls do not listen: turning the bottle does not turn the place
  useLayoutEffect(() => {
    const c = controls.current;
    if (c) c.enabled = !locked;
  }, [locked, camera, gl]);

  useLayoutEffect(() => {
    onAim((point, gap) => {
      const c = controls.current;
      if (!c || locked) return false;
      const want = aimZoom(gap, c.getDistance(), c.minDistance);
      if (want === null) return false;
      // look at the point (held on the place, as a slide is), from the same direction, closer
      const [tx, ty] = framing.target;
      const toTarget = new THREE.Vector3(
        Math.min(tx + framing.reach.x, Math.max(tx - framing.reach.x, point[0])),
        Math.min(ty + framing.reach.y, Math.max(ty - framing.reach.y, point[1])),
        c.target.z,
      );
      const from = c.object.position;
      const to = from.clone().sub(c.target).setLength(want).add(toTarget);
      if (reducedMotion) {
        c.target.copy(toTarget);
        from.copy(to);
        c.update();
      } else
        glide.current = {
          from: from.clone(),
          fromTarget: c.target.clone(),
          to,
          toTarget,
          start: performance.now(),
        };
      invalidate();
      return true;
    });
    return () => {
      onAim(null);
      glide.current = null;
    };
  }, [onAim, framing, invalidate, locked, reducedMotion]);

  useFrame(() => {
    const c = controls.current;
    if (!c || locked) return;
    const g = glide.current;
    if (g) {
      const t = Math.min(1, (performance.now() - g.start) / AIM_MS);
      const k = 1 - (1 - t) ** 3;
      c.object.position.lerpVectors(g.from, g.to, k);
      c.target.lerpVectors(g.fromTarget, g.toTarget, k);
      if (t < 1) invalidate();
      else glide.current = null;
    }
    // the point looked at stays on the place, however the view is slid
    const [tx, ty] = framing.target;
    const x = Math.min(tx + framing.reach.x, Math.max(tx - framing.reach.x, c.target.x));
    const y = Math.min(ty + framing.reach.y, Math.max(ty - framing.reach.y, c.target.y));
    if (x !== c.target.x || y !== c.target.y) {
      c.object.position.x += x - c.target.x;
      c.object.position.y += y - c.target.y;
      c.target.x = x;
      c.target.y = y;
    }
    c.update();
    // and the camera itself stays out of the furniture, at any angle (zooming in at a slant could reach into it)
    const p = c.object.position;
    seen.camera[0] = p.x;
    seen.camera[1] = p.y;
    seen.camera[2] = p.z;
    seen.target[0] = c.target.x;
    seen.target[1] = c.target.y;
    seen.target[2] = c.target.z;
    if (keepOutside(bounds, seen.camera, seen.target, c.maxDistance, seen.out)) {
      p.set(seen.out[0], seen.out[1], seen.out[2]);
      c.object.lookAt(c.target);
      c.domElement!.dataset.distance = c.getDistance().toFixed(2);
    }
  });
  return null;
}

/** Reused on every frame the camera moves: nothing is allocated for keeping it out of the furniture. */
const seen = {
  camera: [0, 0, 0] as Vec3,
  target: [0, 0, 0] as Vec3,
  out: [0, 0, 0] as Vec3,
};

// ---- The furniture --------------------------------------------------------------------------------------------------

/** Nothing of the furniture catches a tap: not a shelf, and above all not a glass door in front of the bottles. */
const noRaycast = () => null;

function Structure({ model, level }: { model: RenderModel; level: Quality }) {
  const { invalidate } = useThree();
  const built = useMemo(() => {
    const owned = new Owned();
    return {
      owned,
      meshes: buildStructure(model, QUALITY[level], owned),
      // premium: the glow round the strips of light, and the shadow the furniture casts where it stands
      ambience: buildAmbience(model, QUALITY[level], owned),
    };
  }, [model, level]);
  useEffect(() => {
    invalidate();
    return () => built.owned.dispose();
  }, [built, invalidate]);
  const { glow, shadow } = built.ambience;
  return (
    <group>
      {shadow && (
        <mesh
          geometry={shadow.geometry}
          material={shadow.material}
          raycast={noRaycast}
          renderOrder={-1}
        />
      )}
      {built.meshes.map((mesh) => (
        <mesh
          key={mesh.role}
          geometry={mesh.geometry}
          material={mesh.material}
          raycast={noRaycast}
          renderOrder={mesh.transparent ? 3 : 0}
        />
      ))}
      {glow && (
        <mesh
          geometry={glow.geometry}
          material={glow.material}
          raycast={noRaycast}
          renderOrder={2}
        />
      )}
    </group>
  );
}

// ---- The bottles ----------------------------------------------------------------------------------------------------

/** How far (px) a finger may move and still be a tap. */
const TAP_SLOP = 8;

function Bottles({
  placed,
  empties,
  model,
  level,
  selectedId,
  targetPose,
  hiddenId,
  onPick,
}: {
  targetPose: Pose | null;
  placed: PlacedBottle[];
  empties: Array<[number, number, number]>;
  model: RenderModel;
  level: Quality;
  selectedId: string | null;
  /** The bottle that is out to be looked at: not drawn here meanwhile (it is drawn once, by the showcase). */
  hiddenId: string | null;
  onPick: ((id: string | null) => void) | undefined;
}) {
  const { invalidate } = useThree();
  const spec = QUALITY[level];
  const kit = useMemo(() => {
    const owned = new Owned();
    return { owned, parts: buildBottleKit(QUALITY[level], owned, model.fidelity) };
  }, [level, model.fidelity]);
  useEffect(() => () => kit.owned.dispose(), [kit]);

  const groups = useMemo(() => bottleGroups(placed), [placed]);
  const selected = selectedId === null ? null : (placed.find((b) => b.id === selectedId) ?? null);
  const marker = useRef<THREE.Mesh>(null);
  useLayoutEffect(() => {
    if (marker.current && selected) {
      markerMatrix(selected.pose, marker.current.matrix);
      marker.current.matrixAutoUpdate = false;
      marker.current.matrixWorldNeedsUpdate = true;
    }
    invalidate();
  }, [selected, invalidate]);

  const targetRing = useRef<THREE.Mesh>(null);
  useLayoutEffect(() => {
    if (targetRing.current && targetPose) {
      markerMatrix(targetPose, targetRing.current.matrix);
      targetRing.current.matrixAutoUpdate = false;
      targetRing.current.matrixWorldNeedsUpdate = true;
    }
    invalidate();
  }, [targetPose, invalidate]);

  const pick = (items: PlacedBottle[]) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > TAP_SLOP) return;
    const item = e.instanceId === undefined ? undefined : items[e.instanceId];
    if (item) onPick?.(item.id);
  };
  // a shadow belongs under a bottle that lies on a shelf: racks only
  const shadows = spec.shadows && model.renderer === "grid";

  return (
    <group>
      {groups.shapes.map(([shape, items]) => (
        <ShapeGroup
          key={`${shape}-${items.length}-${level}`}
          shape={shape}
          items={items}
          kit={kit.parts}
          shadows={shadows}
          // a bottle along a wall throws its shadow on what is behind it (premium, where shadows are drawn)
          wallAt={model.renderer === "wall" ? (model.built.surface ?? 0) : null}
          hiddenId={hiddenId}
          onClick={onPick ? pick(items) : undefined}
        />
      ))}
      {groups.tokens.length > 0 && (
        <Tokens
          // a new level of detail is a new kit: the counters are made anew with it, and placed anew
          key={`tokens-${groups.tokens.length}-${level}`}
          items={groups.tokens}
          kit={kit.parts}
          onClick={onPick ? pick(groups.tokens) : undefined}
        />
      )}
      {empties.length > 0 && (
        <Dots key={`dots-${empties.length}-${level}`} at={empties} kit={kit.parts} model={model} />
      )}
      {targetPose && (
        <mesh
          ref={targetRing}
          name={TARGET_RING_NAME}
          // a wine-red core in a pale keyline: seen on dark wood and on white lacquer alike (sprint 10)
          geometry={kit.parts.targetRing}
          material={kit.parts.ringPaint}
          raycast={noRaycast}
          renderOrder={5}
        />
      )}
      {selected && (
        <mesh
          ref={marker}
          name={MARKER_RING_NAME}
          // a gold core in a dark keyline: the chosen bottle, told from a target by light and dark, not by hue
          geometry={kit.parts.markerRing}
          material={kit.parts.ringPaint}
          raycast={noRaycast}
          renderOrder={5}
        />
      )}
    </group>
  );
}

const colour = new THREE.Color();
const matrix = new THREE.Matrix4();
const PAPER = new THREE.Color("#e8dcc2");
const GONE = new THREE.Vector3(1e-4, 1e-4, 1e-4);

function ShapeGroup({
  shape,
  items,
  kit,
  shadows,
  wallAt,
  hiddenId,
  onClick,
}: {
  shape: BottleShape;
  items: PlacedBottle[];
  kit: BottleKit;
  shadows: boolean;
  /** How far out from the wall the surface behind the bottles is; null when they do not hang on a wall. */
  wallAt: number | null;
  hiddenId: string | null;
  onClick: ((e: ThreeEvent<MouseEvent>) => void) | undefined;
}) {
  const { invalidate } = useThree();
  const glass = useRef<THREE.InstancedMesh>(null);
  const label = useRef<THREE.InstancedMesh>(null);
  const foil = useRef<THREE.InstancedMesh>(null);
  const shade = useRef<THREE.InstancedMesh>(null);
  const wall = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const meshes = [glass.current, label.current, foil.current];
    if (meshes.some((m) => !m)) return;
    items.forEach((item, i) => {
      // the bottle that is out is drawn by the showcase, and only there: here it is shrunk to nothing, in place
      // (kept in place and not quite nothing, so that the group's bounds and its hit-testing stay sound)
      const hidden = item.id === hiddenId;
      poseMatrix(item.pose, matrix);
      if (hidden) matrix.scale(GONE);
      for (const mesh of meshes) mesh!.setMatrixAt(i, matrix);
      glass.current!.setColorAt(i, colour.set(GLASS[item.type]));
      label.current!.setColorAt(i, PAPER);
      foil.current!.setColorAt(i, colour.set(FOIL[item.type]));
      if (shade.current) {
        const [x, y, z] = item.pose.position;
        matrix.makeTranslation(x, y - BOTTLE_R - AIR + 0.006, z);
        if (hidden) matrix.scale(GONE);
        shade.current.setMatrixAt(i, matrix);
      }
      if (wall.current && wallAt !== null) {
        // on the surface behind it, a little below and to the right: the light comes from the upper left
        const [x, y] = item.pose.position;
        matrix.makeTranslation(x + 0.1, y - 0.2, wallAt + 0.006);
        if (hidden) matrix.scale(GONE);
        wall.current.setMatrixAt(i, matrix);
      }
    });
    for (const mesh of [...meshes, shade.current, wall.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // the box that decides whether the whole group is on screen at all
      mesh.computeBoundingSphere();
    }
    invalidate();
  }, [items, hiddenId, wallAt, invalidate]);
  const count = items.length;
  const onWall = wallAt !== null && kit.wallShadow !== null && kit.wallShade !== null;
  return (
    <group>
      <instancedMesh
        ref={glass}
        args={[kit.body[shape], kit.glass, count]}
        {...(onClick ? { onClick } : {})}
        onPointerOver={(e) => {
          e.stopPropagation();
          (e.nativeEvent.target as HTMLElement).style.cursor = "pointer";
        }}
        onPointerOut={(e) => {
          (e.nativeEvent.target as HTMLElement).style.cursor = "grab";
        }}
      />
      <instancedMesh ref={label} args={[kit.label[shape], kit.paper, count]} raycast={noRaycast} />
      <instancedMesh ref={foil} args={[kit.cap[shape], kit.foil, count]} raycast={noRaycast} />
      {shadows && (
        <instancedMesh
          ref={shade}
          args={[kit.shadow, kit.shade, count]}
          renderOrder={1}
          raycast={noRaycast}
        />
      )}
      {onWall && (
        <instancedMesh
          ref={wall}
          args={[kit.wallShadow!, kit.wallShade!, count]}
          renderOrder={1}
          raycast={noRaycast}
        />
      )}
    </group>
  );
}

/** The counters of the neutral picture: one per bottle, in the colour of its wine. They can be chosen like bottles. */
function Tokens({
  items,
  kit,
  onClick,
}: {
  items: PlacedBottle[];
  kit: BottleKit;
  onClick: ((e: ThreeEvent<MouseEvent>) => void) | undefined;
}) {
  const { invalidate } = useThree();
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((item, i) => {
      mesh.setMatrixAt(i, poseMatrix(item.pose, matrix));
      mesh.setColorAt(i, colour.set(FOIL[item.type]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [items, invalidate]);
  return (
    <instancedMesh
      ref={ref}
      args={[kit.token, kit.counter, items.length]}
      {...(onClick ? { onClick } : {})}
    />
  );
}

/** Room that is not taken, in the neutral picture: a small dot per free place in a compartment. */
function Dots({
  at,
  kit,
  model,
}: {
  at: Array<[number, number, number]>;
  kit: BottleKit;
  model: RenderModel;
}) {
  const { invalidate } = useThree();
  const ref = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ color: model.look.surfaces.neutral.color, roughness: 0.8 }),
    [model.look],
  );
  useEffect(() => () => material.dispose(), [material]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    at.forEach((p, i) => mesh.setMatrixAt(i, matrix.makeTranslation(p[0], p[1], p[2] - 0.04)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [at, invalidate]);
  return <instancedMesh ref={ref} args={[kit.dot, material, at.length]} raycast={noRaycast} />;
}

// ---- Free spots on offer (3D Quick Add, sprints 7 and 7.2) ---------------------------------------------------------

/**
 * A point inside a free spot's placeholder, towards the viewer: where a tap on it lands (the readout's `locateSpot`).
 * Inside the bottle, so a ray through it from the camera meets the placeholder whatever the camera's angle: lying
 * towards the viewer (racks, coolers, crates), in the front part of the body; along a wall, at its middle.
 */
function spotMatrix(pose: Pose, out: THREE.Matrix4): THREE.Matrix4 {
  const [x, y, z] = pose.position;
  const front = pose.lie === "z" ? BOTTLE_L * 0.25 : 0;
  return out.makeTranslation(x, y, z + front);
}

/**
 * A see-through placeholder bottle on every free spot (sprint 7.2; sprint 7 drew a gold disc): the same pose a bottle
 * put there would have, pale glass lit by the scene, no icon on it, so it reads as "a bottle can go here" inside the
 * furniture and never as a bottle. ONE instanced mesh, one shared geometry (plainer when hundreds are on offer), one
 * material, nothing allocated per frame: one draw call however many spots there are. The placeholder itself is what is
 * tapped. A tap that moved more than a few pixels, or that ended a camera drag, is not a tap. Resting, a placeholder
 * is pale; under a mouse it is warmer; the chosen one is gold and a little larger (and ringed, by the target ring).
 * Drawn only on demand, like everything else here; nothing moves on its own, so reduced motion needs nothing more.
 */
const at = new THREE.Vector3();
const other = new THREE.Vector3();
const seenAt = new THREE.Vector3();

/** Where a point is on the canvas (CSS px), into `out` (x, y; z is the depth, unused). */
function onScreen(
  p: THREE.Vector3,
  camera: THREE.Camera,
  size: { width: number; height: number },
  out: THREE.Vector3,
) {
  out.copy(p).project(camera);
  out.set(((out.x + 1) / 2) * size.width, ((1 - out.y) / 2) * size.height, out.z);
  return out;
}

/**
 * How far (CSS px) the tapped spot's point is from the nearest other target on the screen as it is now: any other
 * spot on offer, and any bottle (a finger that lands on a bottle beside a spot has not aimed at the spot). Measured
 * at the moment of the tap, from the camera as it is: one pass over the targets, nothing kept.
 */
function gapOnScreen(
  point: THREE.Vector3,
  index: number,
  spots: readonly SpotMarker[],
  placed: readonly PlacedBottle[],
  camera: THREE.Camera,
  size: { width: number; height: number },
): number {
  camera.updateMatrixWorld();
  onScreen(point, camera, size, seenAt);
  const sx = seenAt.x;
  const sy = seenAt.y;
  let gap = Infinity;
  const consider = (pose: Pose) => {
    spotMatrix(pose, matrix);
    other.setFromMatrixPosition(matrix);
    onScreen(other, camera, size, other);
    gap = Math.min(gap, Math.hypot(other.x - sx, other.y - sy));
  };
  spots.forEach((m, i) => {
    if (i !== index) consider(m.pose);
  });
  for (const b of placed) if (b.pose.lie !== "token") consider(b.pose);
  return gap;
}

const GHOST_REST = new THREE.Color("#efe7d6");
const GHOST_HOVER = new THREE.Color("#ffe6b3");
const GHOST_CHOSEN = new THREE.Color("#e9b955");
const LIFT = new THREE.Vector3(GHOST_LIFT, GHOST_LIFT, GHOST_LIFT);
const liftAbout = new THREE.Matrix4();
const liftScale = new THREE.Matrix4();

function SpotMarkers({
  spots,
  placed,
  active,
  dragged,
  aim,
  onSpot,
  onAim,
}: {
  spots: readonly SpotMarker[];
  /** The bottles in the place: targets a finger could land on as well, so they count as neighbours of a spot. */
  placed: readonly PlacedBottle[];
  /**
   * The spot that is chosen now (the sheet or the panel is about it), drawn as chosen: the whole spot, index included
   * (a cell with two free indexes has two placeholders, and only one of them is chosen).
   */
  active: { row: number; col: number; index?: number | undefined } | null;
  dragged: React.RefObject<boolean>;
  aim: React.RefObject<Aim | null>;
  onSpot: ((spot: FreeSpot) => void) | undefined;
  onAim: (() => void) | undefined;
}) {
  const { invalidate, camera, size } = useThree();
  // what pressed the spot that is now tapped: a finger is not as sure as a mouse
  const pointer = useRef<string>("mouse");
  const ref = useRef<THREE.InstancedMesh>(null);
  // the placeholder under a mouse, for THIS list of spots only: a new list never inherits an old list's highlight
  const [hover, setHover] = useState<{ spots: readonly SpotMarker[]; index: number } | null>(null);
  const hovered = hover && hover.spots === spots ? hover.index : null;
  const chosen = useMemo(() => spots.findIndex((m) => sameSpot(m.spot, active)), [spots, active]);
  const radial = ghostRadial(spots.length);
  const geometry = useMemo(() => buildGhostBottle(radial), [radial]);
  // one material for as long as placeholders are shown: a new roundness (120 and 400 spots) is a new geometry only,
  // so the shader program it was compiled into is kept
  const material = useMemo(() => buildGhostMaterial(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  // every placeholder's pose and tone: when the spots or the chosen one change (not on a hover)
  const painted = useRef<number | null>(null);
  const hoveredNow = useRef<number | null>(hovered);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    spots.forEach((m, i) => {
      ghostMatrix(m.pose, i === chosen, matrix);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, ghostTone(i, chosen, hoveredNow.current));
    });
    painted.current = hoveredNow.current;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [spots, chosen, invalidate]);
  // a hover changes the tone of two placeholders at most: only those are written
  useLayoutEffect(() => {
    hoveredNow.current = hovered;
    const mesh = ref.current;
    if (!mesh || painted.current === hovered) return;
    for (const i of [painted.current, hovered])
      if (i !== null && i < spots.length) mesh.setColorAt(i, ghostTone(i, chosen, hovered));
    painted.current = hovered;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [hovered, spots, chosen, invalidate]);
  return (
    <instancedMesh
      // a new number of spots is a new mesh (an instanced mesh's count is fixed when it is made)
      key={spots.length}
      ref={ref}
      name={GHOSTS_NAME}
      args={[geometry, material, spots.length]}
      renderOrder={4}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        pointer.current = e.pointerType;
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > TAP_SLOP || dragged.current) return;
        const i = e.instanceId;
        const m = i === undefined ? undefined : spots[i];
        if (!m || !onSpot) return;
        // a finger on a spot whose neighbours are closer on the screen than a fingertip: not yet a choice. The view
        // comes closer round it, and the next tap is clear (sprint 10). A mouse or a pen is taken at its word.
        if (pointer.current === "touch" && aim.current) {
          spotMatrix(m.pose, matrix);
          at.setFromMatrixPosition(matrix);
          const gap = gapOnScreen(at, i!, spots, placed, camera, size);
          if (aim.current([at.x, at.y, at.z], gap)) {
            onAim?.();
            return;
          }
        }
        onSpot(m.spot);
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        // a finger has no hover: only a mouse or a pen warms a placeholder before it is chosen
        if (!onSpot || e.pointerType === "touch") return;
        (e.nativeEvent.target as HTMLElement).style.cursor = "pointer";
        if (e.instanceId !== undefined) setHover({ spots, index: e.instanceId });
      }}
      onPointerOut={(e: ThreeEvent<PointerEvent>) => {
        // a finger never set a hover or a cursor, so it has none to take back
        if (e.pointerType === "touch") return;
        (e.nativeEvent.target as HTMLElement).style.cursor = "grab";
        setHover((h) => (h && h.index === e.instanceId ? null : h));
      }}
    />
  );
}
/** The placeholders' mesh, by name: for the debug readout and its tests. */
const GHOSTS_NAME = "quick-add-ghosts";
/** The two rings, by name: for the debug readout and its tests. */
const TARGET_RING_NAME = "storage3d-target-ring";
const MARKER_RING_NAME = "storage3d-marker-ring";

/** A placeholder's pose: a bottle's, and the chosen one a little larger about its own middle. */
function ghostMatrix(pose: Pose, chosen: boolean, out: THREE.Matrix4): THREE.Matrix4 {
  poseMatrix(pose, out);
  if (!chosen) return out;
  const [x, y, z] = pose.position;
  out.premultiply(liftAbout.makeTranslation(-x, -y, -z));
  out.premultiply(liftScale.makeScale(LIFT.x, LIFT.y, LIFT.z));
  return out.premultiply(liftAbout.makeTranslation(x, y, z));
}
/** A placeholder's tone: chosen (gold), under a mouse (warmer), or resting (pale). */
const ghostTone = (i: number, chosen: number, hovered: number | null) =>
  i === chosen ? GHOST_CHOSEN : i === hovered ? GHOST_HOVER : GHOST_REST;

// ---- Keeping pace ---------------------------------------------------------------------------------------------------

/**
 * Watches how long frames take WHILE the picture is moving (nothing is drawn when it is still, so there is nothing
 * to time then). Twenty slow frames in a row, slower than 20 a second, and the level of detail goes one step down:
 * a place that turns smoothly with plainer bottles is better than one that stutters with fine ones. It only ever
 * goes down, so it cannot flip back and forth.
 */
function Pace({ level, fixed, onSlow }: { level: Quality; fixed: boolean; onSlow: () => void }) {
  const last = useRef(0);
  const slow = useRef(0);
  const slowCb = useRef(onSlow);
  useEffect(() => {
    slowCb.current = onSlow;
  }, [onSlow]);
  useEffect(() => {
    slow.current = 0;
    last.current = 0;
  }, [level]);
  useFrame(() => {
    if (fixed) return;
    const now = performance.now();
    const gap = now - last.current;
    last.current = now;
    // a gap of over a quarter of a second is not a slow frame: the picture simply stood still in between
    if (gap > 250 || gap <= 0) return;
    slow.current = gap > 50 ? slow.current + 1 : 0;
    if (slow.current >= 20) {
      slow.current = 0;
      slowCb.current();
    }
  });
  return null;
}

// ---- What was drawn, for the gallery and the tests ------------------------------------------------------------------

function Readout({
  model,
  level,
  placed,
  stranded,
  spots,
}: {
  model: RenderModel;
  level: Quality;
  placed: PlacedBottle[];
  stranded: number;
  /** The spots on offer (sprint 7), so a test can tap exactly on one. */
  spots: readonly SpotMarker[] | null;
}) {
  const store = useStore();
  const { gl, camera, size } = useThree();
  const bottles = placed.length;
  const frames = useRef(0);
  useEffect(() => {
    const el = store.getState().gl.domElement;
    el.dataset.renderer = model.renderer;
    el.dataset.template = model.templateId ?? "";
    el.dataset.quality = level;
    el.dataset.bottles = String(bottles);
    el.dataset.stranded = String(stranded);
  }, [store, model, level, bottles, stranded]);
  // how many different models this canvas has been given: a move must not rebuild the furniture
  useEffect(() => {
    const el = store.getState().gl.domElement;
    el.dataset.builds = String(Number(el.dataset.builds ?? "0") + 1);
  }, [store, model]);
  useEffect(() => {
    const el = gl.domElement;
    const { scene } = store.getState();
    const before = scene.onAfterRender;
    scene.onAfterRender = () => {
      frames.current += 1;
      // read here, while the numbers are this frame's (the renderer resets them when the next one begins)
      el.dataset.frames = String(frames.current);
      el.dataset.calls = String(gl.info.render.calls);
      el.dataset.triangles = String(gl.info.render.triangles);
      el.dataset.geometries = String(gl.info.memory.geometries);
      el.dataset.textures = String(gl.info.memory.textures);
      el.dataset.programs = String(gl.info.programs?.length ?? 0);
      if (frames.current === 1) {
        performance.mark("cellr:storage3d-first-frame");
        const created = performance.getEntriesByName("cellr:storage3d-created").at(-1);
        if (created) el.dataset.firstFrameMs = (performance.now() - created.startTime).toFixed(1);
      }
    };
    return () => {
      scene.onAfterRender = before;
    };
  }, [gl, store]);
  // where a bottle is on the screen, so a test can tap exactly on it
  useEffect(() => {
    const w = window as unknown as { __cellrStorage3d?: unknown };
    const project = (position: [number, number, number]) => {
      camera.updateMatrixWorld();
      const p = new THREE.Vector3(...position).project(camera);
      return { x: ((p.x + 1) / 2) * size.width, y: ((1 - p.y) / 2) * size.height };
    };
    w.__cellrStorage3d = {
      project,
      /** Where the end of a bottle that faces the viewer is on the canvas (CSS px), or null. */
      locate(id: string) {
        const b = placed.find((x) => x.id === id);
        if (!b) return null;
        const [x, y, z] = b.pose.position;
        return project(
          b.pose.lie === "z"
            ? [x, y, z + BOTTLE_L / 2 - 0.3]
            : [x, y, z + (b.pose.lie === "x" ? BOTTLE_R : 0)],
        );
      },
      ids: () => placed.map((b) => b.id),
      /**
       * Where the camera is, and whether it is inside the box round the place grown by the clearance (sprint 10: it
       * never should be).
       */
      camera() {
        const p = camera.position;
        const at: Vec3 = [p.x, p.y, p.z];
        return {
          position: at.map((n) => +n.toFixed(3)),
          inside: keepOutside(model.bounds, at, at, Infinity, [0, 0, 0]),
        };
      },
      /** Where the marker of a free spot is on the canvas (CSS px), or null when it is not on offer. */
      locateSpot(row: number, col: number) {
        const m = spots?.find((x) => x.spot.row === row && x.spot.col === col);
        if (!m) return null;
        spotMatrix(m.pose, matrix);
        return project([matrix.elements[12]!, matrix.elements[13]!, matrix.elements[14]!]);
      },
      spots: () => (spots ?? []).map((m) => `${m.spot.row}:${m.spot.col}:${m.spot.index}`),
      /**
       * The placeholders as drawn: how many, their triangles, what they are made of and the size of one (a bottle's
       * length and width, nothing in front of it), or null when none are drawn.
       */
      ghosts() {
        const mesh = store.getState().scene.getObjectByName(GHOSTS_NAME) as
          THREE.InstancedMesh | undefined;
        if (!mesh) return null;
        const g = mesh.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const size = g.boundingBox!.getSize(new THREE.Vector3());
        const objects: string[] = [];
        mesh.traverse((o) => objects.push(o.type));
        // per placeholder, as drawn: its tone (chosen, under a mouse, resting) and whether it is lifted (sprint 10)
        const tone = new THREE.Color();
        const m4 = new THREE.Matrix4();
        const scale = new THREE.Vector3();
        const keys = (spots ?? []).map((x) => `${x.spot.row}:${x.spot.col}:${x.spot.index}`);
        const chosen: string[] = [];
        const hovered: string[] = [];
        const lifted: string[] = [];
        for (let i = 0; i < mesh.count; i++) {
          if (mesh.instanceColor) {
            mesh.getColorAt(i, tone);
            // (held as 32-bit floats: compared with a little room)
            const near = (c: THREE.Color) =>
              Math.abs(c.r - tone.r) + Math.abs(c.g - tone.g) + Math.abs(c.b - tone.b) < 1e-3;
            if (near(GHOST_CHOSEN)) chosen.push(keys[i] ?? String(i));
            else if (near(GHOST_HOVER)) hovered.push(keys[i] ?? String(i));
          }
          mesh.getMatrixAt(i, m4);
          scale.setFromMatrixScale(m4);
          if (scale.x > 1.001) lifted.push(keys[i] ?? String(i));
        }
        return {
          count: mesh.count,
          chosen,
          hovered,
          lifted,
          triangles: (g.index ? g.index.count : g.getAttribute("position").count) / 3,
          attributes: Object.keys(g.attributes).sort(),
          materials: Array.isArray(mesh.material) ? mesh.material.length : 1,
          objects: objects.length,
          length: +size.y.toFixed(3),
          width: +Math.max(size.x, size.z).toFixed(3),
        };
      },
      /** Which of the two rings is drawn now: where a bottle is about to go, and round the chosen bottle. */
      rings() {
        const { scene } = store.getState();
        return {
          target: !!scene.getObjectByName(TARGET_RING_NAME),
          marker: !!scene.getObjectByName(MARKER_RING_NAME),
        };
      },
      /** The shader programs that exist, by name and by what they were compiled for (for the prewarm tests). */
      programs: () =>
        (store.getState().gl.info.programs ?? []).map((p) => `${p.name}|${p.cacheKey}`),
      /** What a ray from a point of the canvas (CSS px) meets, nearest first: for tests of hit-testing. */
      probe(x: number, y: number) {
        const { scene } = store.getState();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(
          new THREE.Vector2((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1),
          camera,
        );
        return ray
          .intersectObjects(scene.children, true)
          .slice(0, 6)
          .map(
            (h) =>
              `${h.object.type}${h.instanceId === undefined ? "" : `#${h.instanceId}`}@${h.distance.toFixed(2)}`,
          );
      },
    };
    return () => {
      delete w.__cellrStorage3d;
    };
  }, [camera, size, placed, store, spots, model]);
  useEffect(() => {
    store.getState().gl.domElement.dataset.spots = spots ? String(spots.length) : "";
  }, [store, spots]);
  return null;
}
