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
  frameFor,
  lowerQuality,
  placeBottles,
  qualityFor,
  type PlacedBottle,
  type Placement,
  type Quality,
  type RenderModel,
  type StoredBottle,
} from "./model";
import { AIR, BOTTLE_L, BOTTLE_R } from "./parts";
import { Inspection, hidesInstance, type InspectionProps } from "./showcase-hero";
import { isOut } from "./showcase-machine";
import {
  Owned,
  bottleGroups,
  buildBottleKit,
  buildStructure,
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
  const outBottle =
    out && inspection
      ? (placement.placed.find((b) => b.id === inspection.state.bottleId) ?? null)
      : null;
  const hiddenId = hidesInstance(outBottle) ? outBottle!.id : null;
  const storage = useRef<THREE.Group>(null);
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
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          if (leaving.current) return;
          e.preventDefault();
          onLost?.();
        });
        performance.mark("cellr:storage3d-created");
        onReady?.();
      }}
      onPointerMissed={() => {
        if (dragged.current) return;
        // beside the bottle that is out: it goes back. Otherwise: nothing is chosen.
        if (out) inspection.onDismiss();
        else onPick?.(null);
      }}
    >
      <Lighting model={model} />
      <Rig model={model} reducedMotion={reducedMotion} dragged={dragged} locked={out} />
      {/* the place itself: not drawn while a picture of it stands in behind the bottle that is out */}
      <group ref={storage}>
        <Structure model={model} level={level} />
        <Bottles
          placed={placement.placed}
          empties={placement.empties}
          model={model}
          level={level}
          selectedId={out ? null : selectedId}
          hiddenId={hiddenId}
          onPick={
            out
              ? () => {
                  if (!dragged.current) inspection.onDismiss();
                }
              : onPick
          }
        />
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

function Rig({
  model,
  reducedMotion,
  dragged,
  locked,
}: {
  model: RenderModel;
  reducedMotion: boolean;
  dragged: React.RefObject<boolean>;
  /** A bottle is out: the camera holds still, so that it comes back to the very view it left. */
  locked: boolean;
}) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const aspect = size.width / Math.max(1, size.height);
  const framing = useMemo(() => frameFor(model.bounds, aspect), [model.bounds, aspect]);
  // the camera is placed once per place; a resize only changes how far it may go
  const placedFor = useRef<RenderModel["bounds"] | null>(null);

  useLayoutEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = !reducedMotion;
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
  }, [camera, gl, reducedMotion, invalidate, dragged]);

  useLayoutEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.minDistance = framing.distance * 0.25;
    c.maxDistance = framing.distance * 1.8;
    if (placedFor.current !== model.bounds) {
      placedFor.current = model.bounds;
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
  }, [framing, model.bounds, camera, invalidate]);

  // while a bottle is out the controls do not listen: turning the bottle does not turn the place
  useLayoutEffect(() => {
    const c = controls.current;
    if (c) c.enabled = !locked;
  }, [locked, camera, gl, reducedMotion]);

  useFrame(() => {
    const c = controls.current;
    if (!c || locked) return;
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
  });
  return null;
}

// ---- The furniture --------------------------------------------------------------------------------------------------

/** Nothing of the furniture catches a tap: not a shelf, and above all not a glass door in front of the bottles. */
const noRaycast = () => null;

function Structure({ model, level }: { model: RenderModel; level: Quality }) {
  const { invalidate } = useThree();
  const built = useMemo(() => {
    const owned = new Owned();
    return { owned, meshes: buildStructure(model, QUALITY[level], owned) };
  }, [model, level]);
  useEffect(() => {
    invalidate();
    return () => built.owned.dispose();
  }, [built, invalidate]);
  return (
    <group>
      {built.meshes.map((mesh) => (
        <mesh
          key={mesh.role}
          geometry={mesh.geometry}
          material={mesh.material}
          raycast={noRaycast}
          renderOrder={mesh.transparent ? 3 : 0}
        />
      ))}
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
  hiddenId,
  onPick,
}: {
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
    return { owned, parts: buildBottleKit(QUALITY[level], owned) };
  }, [level]);
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
      {selected && (
        <mesh
          ref={marker}
          geometry={kit.parts.ring}
          material={kit.parts.marker}
          raycast={noRaycast}
          renderOrder={2}
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
  hiddenId,
  onClick,
}: {
  shape: BottleShape;
  items: PlacedBottle[];
  kit: BottleKit;
  shadows: boolean;
  hiddenId: string | null;
  onClick: ((e: ThreeEvent<MouseEvent>) => void) | undefined;
}) {
  const { invalidate } = useThree();
  const glass = useRef<THREE.InstancedMesh>(null);
  const label = useRef<THREE.InstancedMesh>(null);
  const foil = useRef<THREE.InstancedMesh>(null);
  const shade = useRef<THREE.InstancedMesh>(null);
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
    });
    for (const mesh of [...meshes, shade.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // the box that decides whether the whole group is on screen at all
      mesh.computeBoundingSphere();
    }
    invalidate();
  }, [items, hiddenId, invalidate]);
  const count = items.length;
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
}: {
  model: RenderModel;
  level: Quality;
  placed: PlacedBottle[];
  stranded: number;
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
  }, [camera, size, placed, store]);
  return null;
}
