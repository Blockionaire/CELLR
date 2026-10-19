"use client";

import { Canvas, useFrame, useStore, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { StorageKind } from "@cellr/domain";
import type { BottleShape } from "@/ui/bottle-glyph";
import {
  BOTTLE_LENGTH,
  FOIL,
  FOV,
  FRAME,
  GLASS,
  RACK_DEPTH,
  SHAPES,
  SLOT,
  STORAGE_LOOK,
  cameraDistance,
  capsulePoints,
  lathePoints,
  slotPosition,
  unitSize,
  type ShowcaseLayout,
} from "./layout";
import { contactShadowTexture, lookMaterials } from "./materials";
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
  /** The browser took the graphics memory back (iOS does this to a page in the background). */
  onLost?: () => void;
}

/** A still of the rack, and where on the screen (in percent) the bottle that came out of it was. */
export interface Backdrop {
  url: string;
  originX: number;
  originY: number;
}

/**
 * Sharpness cap. A small phone (few cores or little memory) draws at 1.5× instead of 2×: barely visible on a
 * bottle, but nearly half the pixels to fill, so it stays cool and the battery lasts.
 */
function maxDpr() {
  if (typeof navigator === "undefined") return 2;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const lowPower =
    (navigator.hardwareConcurrency ?? 8) <= 4 || (memory !== undefined && memory <= 4);
  return lowPower ? 1.5 : 2;
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
  onLost,
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
      dpr={[1, maxDpr()]}
      camera={{ fov: FOV, near: 0.1, far: 400 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        // Neutral tone mapping keeps a label's own colours (ACES would wash out reds and creams).
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          // Ours to handle: the page offers to draw it again instead of leaving a blank box.
          e.preventDefault();
          onLost?.();
        });
        onReady?.();
      }}
      onPointerMissed={() => {
        if (locked && !dragged.current) onDismiss();
      }}
    >
      <Lighting />
      <Rig
        rows={rows}
        cols={cols}
        reducedMotion={reducedMotion}
        locked={locked}
        held={shown !== null}
      />
      <group visible={!frozen}>
        <RackFrame rows={rows} cols={cols} kind={kind} />
        <Bottles
          rows={rows}
          cols={cols}
          board={FRAME * STORAGE_LOOK[kind].board}
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
    scene.environmentIntensity = 0.65;
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
      {/* Studio light: a warm key from above left, a soft fill from the floor, a cool rim behind to draw the glass. */}
      <hemisphereLight args={["#fff3e2", "#2b1d16", 0.5]} />
      <directionalLight position={[-7, 10, 12]} intensity={2.1} color="#fff0da" />
      <directionalLight position={[8, 3, -6]} intensity={0.9} color="#dfe8ff" />
      <pointLight position={[6, -3, 9]} intensity={38} color="#ffc394" distance={40} decay={2} />
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
  held,
}: {
  rows: number;
  cols: number;
  reducedMotion: boolean;
  /** A bottle is on display: the camera holds still. */
  locked: boolean;
  /** A bottle is out of the rack (on display, or on its way back). */
  held: boolean;
}) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const lockedNow = useRef(locked);
  const aspect = size.width / Math.max(1, size.height);
  const distance = cameraDistance(rows, cols, aspect);
  const { width, height } = unitSize(rows, cols);

  useLayoutEffect(() => {
    // A little to the side and above, so you read depth straight away.
    const azimuth = 0.22;
    const elevation = 0.11;
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

  // On a phone the view fills the screen while a bottle is out: much taller than the card it was. With the same
  // (vertical) angle of view the rack would suddenly be seen far narrower, and a bottle from an outer slot would
  // come out off-screen. So while a bottle is out the view keeps the card's width and only gains height.
  const freeAspect = useRef(aspect);
  const heldNow = useRef(held);
  useEffect(() => {
    heldNow.current = held;
    invalidate();
  }, [held, invalidate]);

  useEffect(() => {
    lockedNow.current = locked;
    if (controls.current) controls.current.enabled = !locked;
  }, [locked]);

  useFrame((state) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    const now = state.size.width / Math.max(1, state.size.height);
    if (!heldNow.current) freeAspect.current = now;
    const ratio = freeAspect.current / now;
    const fov =
      ratio > 1
        ? THREE.MathUtils.radToDeg(
            2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * ratio),
          )
        : FOV;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const c = controls.current;
    if (!c) return;
    keepOnRack(c, width, height);
    c.update();
  });
  return null;
}

// ---- The rack ------------------------------------------------------------------------------------------------

/**
 * The storage itself, in the materials of its kind (see STORAGE_LOOK): boards with softened edges, a back, and for
 * a wine fridge a brushed metal shell, wooden slide-out shelves with a metal edge and a warm strip of light at the
 * top. A soft shadow on the floor grounds it. The layout is exactly the configured rows and columns.
 */
function RackFrame({ rows, cols, kind }: { rows: number; cols: number; kind: StorageKind }) {
  const look = STORAGE_LOOK[kind];
  const { width, height } = unitSize(rows, cols);
  const t = FRAME * look.board;
  const materials = useMemo(() => lookMaterials(look, width, height), [look, width, height]);
  const floor = useMemo(() => contactShadowTexture(), []);
  const geometry = useMemo(() => {
    const edge = Math.min(0.035, t / 2.5);
    return {
      // shelves run between the two sides; the sides stand just outside the bottles
      shelf: new RoundedBoxGeometry(cols * SLOT + 0.02, t, RACK_DEPTH, 2, edge),
      side: new RoundedBoxGeometry(t * 1.25, height + t, RACK_DEPTH + 0.06, 2, edge),
      divider: new RoundedBoxGeometry(t * 0.55, height - t, RACK_DEPTH * 0.97, 2, edge * 0.6),
      back: new THREE.PlaneGeometry(width, height),
      lip: new THREE.BoxGeometry(cols * SLOT, 0.045, 0.04),
      glow: new THREE.BoxGeometry(width * 0.86, 0.025, 0.06),
      plinth: new RoundedBoxGeometry(cols * SLOT + t * 3.2, t * 1.6, RACK_DEPTH + 0.12, 2, edge),
    };
  }, [width, height, t, cols]);
  useEffect(
    () => () => {
      materials.dispose();
      Object.values(geometry).forEach((g) => g.dispose());
    },
    [materials, geometry],
  );

  const shelves = Array.from({ length: rows + 1 }, (_, i) => rows / 2 - i);
  const dividers = look.dividers
    ? Array.from({ length: cols - 1 }, (_, i) => (i + 1 - cols / 2) * SLOT)
    : [];
  const sideX = (cols * SLOT) / 2 + (t * 1.25) / 2;

  return (
    <group>
      <mesh
        geometry={geometry.back}
        material={materials.back}
        position={[0, 0, -RACK_DEPTH / 2 - 0.01]}
        raycast={() => null}
      />
      {shelves.map((y, i) => (
        <group key={`s${i}`} position={[0, y, 0]}>
          <mesh geometry={geometry.shelf} material={materials.shelf} raycast={() => null} />
          {look.lip && i > 0 && i < rows && (
            <mesh
              geometry={geometry.lip}
              material={materials.lip}
              position={[0, t / 2 - 0.005, RACK_DEPTH / 2 - 0.02]}
              raycast={() => null}
            />
          )}
        </group>
      ))}
      {[-sideX, sideX].map((x) => (
        <mesh
          key={`side${x}`}
          geometry={geometry.side}
          material={materials.frame}
          position={[x, 0, 0]}
          raycast={() => null}
        />
      ))}
      {dividers.map((x) => (
        <mesh
          key={`d${x}`}
          geometry={geometry.divider}
          material={materials.shelf}
          position={[x, 0, -0.02]}
          raycast={() => null}
        />
      ))}
      {kind === "cabinet" && (
        <mesh
          geometry={geometry.plinth}
          material={materials.frame}
          position={[0, -height / 2 - t * 0.5, 0]}
          raycast={() => null}
        />
      )}
      {look.glow && (
        <>
          <mesh
            geometry={geometry.glow}
            material={materials.glow}
            position={[0, height / 2 - t / 2 - 0.03, RACK_DEPTH / 2 - 0.25]}
            raycast={() => null}
          />
          <pointLight
            position={[0, height / 2 - 0.4, RACK_DEPTH / 2 - 0.6]}
            intensity={6 + width * 1.5}
            color="#ffd7a3"
            distance={Math.max(6, height * 1.4)}
            decay={1.6}
          />
        </>
      )}
      {/* the floor under it, softly darkened */}
      <mesh
        position={[0, -height / 2 - (kind === "cabinet" ? t * 1.3 : t / 2) - 0.01, 0.2]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[width * 1.45, RACK_DEPTH * 1.7, 1]}
        raycast={() => null}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={floor} transparent opacity={0.75} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---- The bottles ---------------------------------------------------------------------------------------------

function Bottles({
  rows,
  cols,
  board,
  bottles,
  hiddenId,
  locked,
  onPick,
  onDismiss,
}: {
  rows: number;
  cols: number;
  /** Thickness of the boards the bottles lie on. */
  board: number;
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
          board={board}
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
  board,
  hiddenId,
  locked,
  onPick,
  onDismiss,
}: {
  shape: BottleShape;
  items: SceneBottle[];
  rows: number;
  cols: number;
  board: number;
  hiddenId: string | null;
  locked: boolean;
  onPick: (id: string) => void;
  onDismiss: () => void;
}) {
  const { invalidate } = useThree();
  const glass = useRef<THREE.InstancedMesh>(null);
  const label = useRef<THREE.InstancedMesh>(null);
  const foil = useRef<THREE.InstancedMesh>(null);
  const shade = useRef<THREE.InstancedMesh>(null);

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
    const cap = new THREE.LatheGeometry(
      capsulePoints(shape).map(([r, y]) => new THREE.Vector2(r, y)),
      28,
    );
    // The soft shadow each bottle casts on the board it lies on: a flat oval under its length.
    const shadow = new THREE.PlaneGeometry(spec.radius * 2.1, BOTTLE_LENGTH * 0.96);
    shadow.rotateX(-Math.PI / 2);
    return { body, lab, cap, shadow };
  }, [shape, spec]);
  const materials = useMemo(
    () => ({
      // Thick glass seen in a rack: dark, with sharp reflections of the room (no light through it, which would
      // cost a second rendering of the scene for every bottle).
      glass: new THREE.MeshPhysicalMaterial({
        color: WHITE,
        roughness: 0.05,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        ior: 1.5,
        specularIntensity: 1,
        envMapIntensity: 1.35,
      }),
      label: new THREE.MeshStandardMaterial({ color: LABEL, roughness: 0.85 }),
      foil: new THREE.MeshStandardMaterial({
        color: WHITE,
        roughness: 0.32,
        metalness: 0.75,
        envMapIntensity: 1.1,
      }),
      shadow: new THREE.MeshBasicMaterial({
        map: contactShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      }),
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
  const shadowAt = useMemo(() => new THREE.Matrix4(), []);
  useLayoutEffect(() => {
    const meshes = [glass.current, label.current, foil.current];
    if (meshes.some((m) => !m) || !shade.current) return;
    items.forEach((item, i) => {
      // A bottle that is out on display leaves an empty slot behind, not a ghost.
      const out = item.id === hiddenId;
      const m = out ? vanished : place(item);
      for (const mesh of meshes) mesh!.setMatrixAt(i, m);
      const [x, y] = slotPosition(item.row, item.col, rows, cols);
      // on the top face of the board below, a hair above it so it never flickers into the wood
      shade.current!.setMatrixAt(
        i,
        out ? vanished : shadowAt.makeTranslation(x, y - SLOT / 2 + board / 2 + 0.006, 0),
      );
      glass.current!.setColorAt(i, colour.set(GLASS[item.type]));
      label.current!.setColorAt(i, colour.set(LABEL));
      foil.current!.setColorAt(i, colour.set(FOIL[item.type]));
    });
    for (const mesh of [...meshes, shade.current]) {
      mesh!.instanceMatrix.needsUpdate = true;
      if (mesh!.instanceColor) mesh!.instanceColor.needsUpdate = true;
    }
    invalidate();
  }, [items, rows, cols, board, hiddenId, place, vanished, shadowAt, colour, invalidate]);

  const count = items.length;
  return (
    <group>
      <instancedMesh
        ref={glass}
        args={[geometries.body, materials.glass, count]}
        frustumCulled={false}
        onClick={(e) => {
          e.stopPropagation();
          // While a bottle is on display, a tap on the rack just puts it back (not the end of turning the bottle).
          if (locked) {
            if (e.delta <= 6) onDismiss();
            return;
          }
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
      <instancedMesh
        ref={shade}
        args={[geometries.shadow, materials.shadow, count]}
        frustumCulled={false}
        renderOrder={1}
        raycast={() => null}
      />
    </group>
  );
}
