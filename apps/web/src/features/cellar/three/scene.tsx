"use client";

import { Canvas, useFrame, useStore, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { StorageKind } from "@cellr/domain";
import type { BottleShape } from "@/ui/bottle-glyph";
import {
  BOTTLE_LENGTH,
  FOIL,
  FOV,
  FRAME,
  FRAME_COLOUR,
  GLASS,
  RACK_DEPTH,
  SHAPES,
  SLOT,
  cameraDistance,
  lathePoints,
  slotPosition,
  unitSize,
  type ShowcaseLayout,
} from "./layout";
import { Showcase } from "./showcase";
import type { SceneBottle, ShownBottle } from "./types";

export type { SceneBottle, ShownBottle } from "./types";

export interface SceneProps {
  rows: number;
  cols: number;
  kind: StorageKind;
  bottles: SceneBottle[];
  /** The bottle to take out and put on display, or null to put it back. */
  showcase: ShownBottle | null;
  /** When the displayed bottle leaves: back "home" into its slot, or "gone" (it was opened). */
  exit: "home" | "gone";
  layout: ShowcaseLayout;
  /** CSS colour the rack fades towards behind the displayed bottle. */
  veil: string;
  onPick: (id: string) => void;
  /** A tap anywhere but on the displayed bottle while it is out. */
  onDismiss: () => void;
  reducedMotion: boolean;
  onReady?: () => void;
  /**
   * While a bottle is on display the rack is not drawn: a still picture of it (blurred and dimmed by the page) stands
   * in, so it cannot move however the bottle is turned. Null = the rack is live again.
   */
  onBackdrop?: (backdrop: Backdrop | null) => void;
}

/** A still of the rack, and where on the screen (in percent) the bottle that came out of it was. */
export interface Backdrop {
  url: string;
  originX: number;
  originY: number;
}

/** A tiny lift so bottles rest with their necks slightly up, like in a real rack. */
const TILT = 0.04;

/**
 * One storage unit in 3D: a frame, its bottles lying in their spots with their necks towards you,
 * soft procedural lighting (no downloaded images), and drag / pinch to look around.
 * Renders only when something changes (demand frames), so it is gentle on a phone's battery.
 */
export default function CellarScene({
  rows,
  cols,
  kind,
  bottles,
  showcase,
  exit,
  layout,
  veil,
  onPick,
  onDismiss,
  reducedMotion,
  onReady,
  onBackdrop,
}: SceneProps) {
  // The bottle on display stays here a little after `showcase` is cleared, while it goes back.
  const [shown, setShown] = useState<ShownBottle | null>(showcase);
  if (
    showcase &&
    (showcase.bottle.id !== shown?.bottle.id ||
      JSON.stringify(showcase.label) !== JSON.stringify(shown.label))
  )
    setShown(showcase);
  const dragged = useRef(false);
  const onDrag = useCallback((moved: boolean) => {
    dragged.current = moved;
  }, []);
  const [frozen, setFrozen] = useState(false);
  const showRef = useRef<THREE.Group>(null);
  const onGone = useCallback(() => {
    setShown(null);
    setFrozen(false);
    // The live rack is drawn in the next frame. The still goes only after that (two frames on), or for one
    // frame there is no rack at all and the bottle seems to come loose and jump into its place.
    requestAnimationFrame(() => requestAnimationFrame(() => onBackdrop?.(null)));
  }, [onBackdrop]);
  const onFrozen = useCallback(
    (backdrop: Backdrop) => {
      setFrozen(true);
      onBackdrop?.(backdrop);
    },
    [onBackdrop],
  );
  const locked = showcase !== null;

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: FOV, near: 0.1, far: 400 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        onReady?.();
      }}
      onPointerMissed={() => {
        if (locked && !dragged.current) onDismiss();
      }}
    >
      <Lighting />
      <Rig rows={rows} cols={cols} reducedMotion={reducedMotion} locked={locked} />
      <group visible={!frozen}>
        <RackFrame rows={rows} cols={cols} kind={kind} />
        <Bottles
          rows={rows}
          cols={cols}
          bottles={bottles}
          hiddenId={shown?.bottle.id ?? null}
          locked={locked}
          onPick={onPick}
          onDismiss={onDismiss}
        />
      </group>
      {shown && (
        <>
          <Freezer
            target={shown.bottle}
            rows={rows}
            cols={cols}
            frozen={frozen}
            hideRef={showRef}
            onFrozen={onFrozen}
          />
          <group ref={showRef}>
            <Showcase
              key={shown.bottle.id}
              shown={shown}
              bottles={bottles}
              rows={rows}
              cols={cols}
              open={showcase !== null}
              exit={exit}
              layout={layout}
              veil={veil}
              useVeil={!frozen}
              reducedMotion={reducedMotion}
              onGone={onGone}
              onDrag={onDrag}
            />
          </group>
        </>
      )}
    </Canvas>
  );
}

// ---- Light -------------------------------------------------------------------------------------------

function Lighting() {
  const store = useStore();
  useEffect(() => {
    // A procedural "room" for reflections on the glass: nothing is fetched from anywhere.
    const { gl, scene, invalidate } = store.getState();
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.75;
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
      room.dispose();
    };
  }, [store]);

  return (
    <>
      <hemisphereLight args={["#fff4e6", "#2a1d17", 0.55]} />
      <directionalLight position={[-6, 9, 12]} intensity={1.7} color="#fff1dc" />
      <pointLight position={[7, -2, 10]} intensity={60} color="#ffb98a" distance={40} decay={2} />
    </>
  );
}

// ---- A still of the rack -----------------------------------------------------------------------------------------

/**
 * The moment a bottle is taken out, draws the rack (without that bottle, and without the bottle on display) once
 * and hands the picture to the page. From then on the rack is not drawn at all: the page shows the picture, blurred
 * and dimmed, so the background holds perfectly still however the bottle is turned, and costs nothing to render.
 */
function Freezer({
  target,
  rows,
  cols,
  frozen,
  hideRef,
  onFrozen,
}: {
  target: SceneBottle;
  rows: number;
  cols: number;
  frozen: boolean;
  hideRef: React.RefObject<THREE.Group | null>;
  onFrozen: (backdrop: Backdrop) => void;
}) {
  const { gl, scene, camera } = useThree();
  const done = useRef<string | null>(null);
  useEffect(() => {
    // One picture per time the rack is lifted out of the picture; a bottle taken while it is frozen reuses it.
    if (frozen || done.current === target.id) return;
    done.current = target.id;
    const group = hideRef.current;
    try {
      if (group) group.visible = false;
      camera.updateMatrixWorld();
      gl.render(scene, camera);
      const [x, y, z] = slotPosition(target.row, target.col, rows, cols);
      const at = new THREE.Vector3(x, y, z).project(camera);
      const originX = ((at.x + 1) / 2) * 100;
      const originY = ((1 - at.y) / 2) * 100;
      gl.domElement.toBlob((blob) => {
        // Without a picture the rack simply stays live, behind the usual veil.
        if (!blob || done.current !== target.id) return;
        onFrozen({ url: URL.createObjectURL(blob), originX, originY });
      }, "image/png");
    } catch {
      // keep the live rack
    } finally {
      if (group) group.visible = true;
    }
  }, [target, rows, cols, frozen, gl, scene, camera, hideRef, onFrozen]);
  return null;
}

/** Keeps the point being looked at on the rack: sliding the view (or zooming towards a corner) never loses it. */
function keepOnRack(c: OrbitControls, width: number, height: number): void {
  const t = c.target;
  const x = Math.min(width / 2, Math.max(-width / 2, t.x));
  const y = Math.min(height / 2, Math.max(-height / 2, t.y));
  if (x === t.x && y === t.y) return;
  c.object.position.x += x - t.x;
  c.object.position.y += y - t.y;
  t.x = x;
  t.y = y;
}

// ---- Camera and controls ---------------------------------------------------------------------------------

function Rig({
  rows,
  cols,
  reducedMotion,
  locked,
}: {
  rows: number;
  cols: number;
  reducedMotion: boolean;
  /** A bottle is on display: the camera holds still. */
  locked: boolean;
}) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const lockedNow = useRef(locked);
  const aspect = size.width / Math.max(1, size.height);
  const distance = cameraDistance(rows, cols, aspect);
  const { width, height } = unitSize(rows, cols);

  useLayoutEffect(() => {
    // A little to the side and above, so you read depth straight away.
    const azimuth = 0.3;
    const elevation = 0.14;
    camera.position.set(
      distance * Math.sin(azimuth) * Math.cos(elevation),
      distance * Math.sin(elevation),
      distance * Math.cos(azimuth) * Math.cos(elevation),
    );
    camera.lookAt(0, 0, 0);

    const c = new OrbitControls(camera, gl.domElement);
    c.target.set(0, 0, 0);
    c.enableDamping = !reducedMotion;
    c.dampingFactor = 0.09;
    // Zoom goes towards where you point (so the top and the bottom of a tall rack can both be reached), and
    // two fingers (or the right mouse button) slide the view; it never leaves the rack, see below.
    c.zoomToCursor = true;
    c.enablePan = true;
    c.screenSpacePanning = true;
    c.minAzimuthAngle = -0.95;
    c.maxAzimuthAngle = 0.95;
    c.minPolarAngle = 0.75;
    c.maxPolarAngle = 1.75;
    c.rotateSpeed = 0.7;
    c.zoomSpeed = 0.8;
    c.panSpeed = 0.9;
    // A bottle on display: the rack is not to be moved by turning it.
    c.enabled = !lockedNow.current;
    const onChange = () => {
      // Where the view is looking, readable from outside (the tests use it to check where zoom goes).
      gl.domElement.dataset.target = `${c.target.x.toFixed(2)},${c.target.y.toFixed(2)}`;
      gl.domElement.dataset.distance = c.getDistance().toFixed(2);
      invalidate();
    };
    c.addEventListener("change", onChange);
    c.update();
    controls.current = c;
    invalidate();
    return () => {
      c.removeEventListener("change", onChange);
      c.dispose();
      controls.current = null;
    };
    // The camera is placed once per unit; a resize (the screen filling up when a bottle comes out) must neither
    // move it nor hand control back, so the size is deliberately not a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols, reducedMotion]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.minDistance = distance * 0.3;
    c.maxDistance = distance * 1.8;
    invalidate();
  }, [distance, invalidate]);

  useEffect(() => {
    lockedNow.current = locked;
    if (controls.current) controls.current.enabled = !locked;
  }, [locked]);

  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    keepOnRack(c, width, height);
    c.update();
  });
  return null;
}

// ---- The rack ------------------------------------------------------------------------------------------------

function RackFrame({ rows, cols, kind }: { rows: number; cols: number; kind: StorageKind }) {
  const { width, height } = unitSize(rows, cols);
  const colour = FRAME_COLOUR[kind];
  const dividers = kind !== "fridge";
  const shelves = Array.from({ length: rows + 1 }, (_, i) => rows / 2 - i);
  const uprights = Array.from({ length: cols + 1 }, (_, i) => (i - cols / 2) * SLOT);

  return (
    <group>
      <mesh position={[0, 0, -RACK_DEPTH / 2 - FRAME * 0.2]}>
        <boxGeometry args={[width, height, FRAME * 0.5]} />
        <meshStandardMaterial color="#161110" roughness={0.95} />
      </mesh>
      {shelves.map((y) => (
        <mesh key={`s${y}`} position={[0, y, 0]}>
          <boxGeometry args={[width, FRAME, RACK_DEPTH]} />
          <meshStandardMaterial
            color={colour}
            roughness={kind === "fridge" ? 0.35 : 0.7}
            metalness={kind === "fridge" ? 0.6 : 0.05}
          />
        </mesh>
      ))}
      {uprights.map((x, i) => {
        const outer = i === 0 || i === uprights.length - 1;
        if (!outer && !dividers) return null;
        return (
          <mesh key={`u${i}`} position={[x, 0, 0]}>
            <boxGeometry args={[outer ? FRAME : FRAME * 0.5, height, RACK_DEPTH]} />
            <meshStandardMaterial
              color={colour}
              roughness={kind === "fridge" ? 0.35 : 0.7}
              metalness={kind === "fridge" ? 0.6 : 0.05}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ---- The bottles ---------------------------------------------------------------------------------------------

function Bottles({
  rows,
  cols,
  bottles,
  hiddenId,
  locked,
  onPick,
  onDismiss,
}: {
  rows: number;
  cols: number;
  bottles: SceneBottle[];
  /** The bottle that has left its slot (drawn separately while it is out). */
  hiddenId: string | null;
  locked: boolean;
  onPick: (id: string) => void;
  onDismiss: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<BottleShape, SceneBottle[]>();
    for (const b of bottles) map.set(b.shape, [...(map.get(b.shape) ?? []), b]);
    return [...map.entries()];
  }, [bottles]);
  return (
    <>
      {groups.map(([shape, items]) => (
        <ShapeGroup
          key={`${shape}-${items.length}`}
          shape={shape}
          items={items}
          rows={rows}
          cols={cols}
          hiddenId={hiddenId}
          locked={locked}
          onPick={onPick}
          onDismiss={onDismiss}
        />
      ))}
    </>
  );
}

const WHITE = new THREE.Color("#ffffff");
const LABEL = new THREE.Color("#e8dcc2");

function ShapeGroup({
  shape,
  items,
  rows,
  cols,
  hiddenId,
  locked,
  onPick,
  onDismiss,
}: {
  shape: BottleShape;
  items: SceneBottle[];
  rows: number;
  cols: number;
  hiddenId: string | null;
  locked: boolean;
  onPick: (id: string) => void;
  onDismiss: () => void;
}) {
  const { invalidate } = useThree();
  const glass = useRef<THREE.InstancedMesh>(null);
  const label = useRef<THREE.InstancedMesh>(null);
  const foil = useRef<THREE.InstancedMesh>(null);

  const spec = SHAPES[shape];
  const geometries = useMemo(() => {
    const body = new THREE.LatheGeometry(
      lathePoints(shape).map(([r, y]) => new THREE.Vector2(r, y)),
      40,
    );
    const labelFrom = 0.16 * BOTTLE_LENGTH;
    const labelTo = Math.min(spec.bodyEnd - 0.04, 0.48) * BOTTLE_LENGTH;
    const lab = new THREE.CylinderGeometry(
      spec.radius + 0.008,
      spec.radius + 0.008,
      labelTo - labelFrom,
      40,
      1,
      true,
    );
    lab.translate(0, (labelFrom + labelTo) / 2, 0);
    const foilFrom = 0.865 * BOTTLE_LENGTH;
    const cap = new THREE.CylinderGeometry(
      spec.neckRadius * 1.12,
      spec.neckRadius * 1.12,
      BOTTLE_LENGTH - foilFrom - 0.012,
      24,
    );
    cap.translate(0, foilFrom + (BOTTLE_LENGTH - foilFrom - 0.012) / 2, 0);
    return { body, lab, cap };
  }, [shape, spec]);
  const materials = useMemo(
    () => ({
      glass: new THREE.MeshPhysicalMaterial({
        color: WHITE,
        roughness: 0.14,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
      }),
      label: new THREE.MeshStandardMaterial({ color: LABEL, roughness: 0.85 }),
      foil: new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.35, metalness: 0.55 }),
    }),
    [],
  );
  useEffect(
    () => () => {
      Object.values(geometries).forEach((g) => g.dispose());
      Object.values(materials).forEach((m) => m.dispose());
    },
    [geometries, materials],
  );

  // One object reused to build each bottle's matrix: slot → position, lying down with the neck towards you.
  const place = useMemo(() => {
    const dummy = new THREE.Object3D();
    const local = new THREE.Matrix4().makeTranslation(0, -BOTTLE_LENGTH / 2, 0);
    const out = new THREE.Matrix4();
    return (item: SceneBottle): THREE.Matrix4 => {
      const [x, y, z] = slotPosition(item.row, item.col, rows, cols);
      dummy.position.set(x, y, z);
      dummy.rotation.set(Math.PI / 2 - TILT, 0, 0);
      dummy.updateMatrix();
      return out.copy(dummy.matrix).multiply(local);
    };
  }, [rows, cols]);

  const colour = useMemo(() => new THREE.Color(), []);
  const vanished = useMemo(() => new THREE.Matrix4().makeScale(0, 0, 0), []);
  useLayoutEffect(() => {
    const meshes = [glass.current, label.current, foil.current];
    if (meshes.some((m) => !m)) return;
    items.forEach((item, i) => {
      // A bottle that is out on display leaves an empty slot behind, not a ghost.
      const m = item.id === hiddenId ? vanished : place(item);
      for (const mesh of meshes) mesh!.setMatrixAt(i, m);
      glass.current!.setColorAt(i, colour.set(GLASS[item.type]));
      label.current!.setColorAt(i, colour.set(LABEL));
      foil.current!.setColorAt(i, colour.set(FOIL[item.type]));
    });
    for (const mesh of meshes) {
      mesh!.instanceMatrix.needsUpdate = true;
      if (mesh!.instanceColor) mesh!.instanceColor.needsUpdate = true;
    }
    invalidate();
  }, [items, rows, cols, hiddenId, place, vanished, colour, invalidate]);

  const count = items.length;
  return (
    <group>
      <instancedMesh
        ref={glass}
        args={[geometries.body, materials.glass, count]}
        frustumCulled={false}
        onClick={(e) => {
          e.stopPropagation();
          // While a bottle is on display, a tap on the rack just puts it back.
          if (locked) return onDismiss();
          const item = e.instanceId === undefined ? undefined : items[e.instanceId];
          if (item) onPick(item.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          (e.nativeEvent.target as HTMLElement).style.cursor = "pointer";
        }}
        onPointerOut={(e) => {
          (e.nativeEvent.target as HTMLElement).style.cursor = "grab";
        }}
      />
      <instancedMesh
        ref={label}
        args={[geometries.lab, materials.label, count]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={foil}
        args={[geometries.cap, materials.foil, count]}
        frustumCulled={false}
      />
    </group>
  );
}
