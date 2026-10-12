"use client";

import { Canvas, useFrame, useStore, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { StorageKind, WineType } from "@cellr/domain";
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
} from "./layout";

export interface SceneBottle {
  id: string;
  row: number;
  col: number;
  type: WineType;
  shape: BottleShape;
}

export interface SceneProps {
  rows: number;
  cols: number;
  kind: StorageKind;
  bottles: SceneBottle[];
  selectedId: string | null;
  onPick: (id: string) => void;
  reducedMotion: boolean;
  onReady?: () => void;
}

/** A tiny lift so bottles rest with their necks slightly up, like in a real rack. */
const TILT = 0.04;
/** How far the chosen bottle slides out towards you. */
const PULL = 0.9;

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
  selectedId,
  onPick,
  reducedMotion,
  onReady,
}: SceneProps) {
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
    >
      <Lighting />
      <Rig rows={rows} cols={cols} reducedMotion={reducedMotion} />
      <RackFrame rows={rows} cols={cols} kind={kind} />
      <Bottles rows={rows} cols={cols} bottles={bottles} selectedId={selectedId} onPick={onPick} />
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

// ---- Camera and controls ---------------------------------------------------------------------------------

function Rig({
  rows,
  cols,
  reducedMotion,
}: {
  rows: number;
  cols: number;
  reducedMotion: boolean;
}) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const aspect = size.width / Math.max(1, size.height);
  const distance = cameraDistance(rows, cols, aspect);

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
    c.enablePan = false;
    c.minDistance = distance * 0.35;
    c.maxDistance = distance * 1.8;
    c.minAzimuthAngle = -0.95;
    c.maxAzimuthAngle = 0.95;
    c.minPolarAngle = 0.75;
    c.maxPolarAngle = 1.75;
    c.rotateSpeed = 0.7;
    c.zoomSpeed = 0.8;
    const onChange = () => invalidate();
    c.addEventListener("change", onChange);
    c.update();
    controls.current = c;
    invalidate();
    return () => {
      c.removeEventListener("change", onChange);
      c.dispose();
      controls.current = null;
    };
    // The camera is placed once per unit/size; the user's own movements are never overridden afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols, Math.round(distance * 10), reducedMotion]);

  useFrame(() => controls.current?.update());
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
  selectedId,
  onPick,
}: {
  rows: number;
  cols: number;
  bottles: SceneBottle[];
  selectedId: string | null;
  onPick: (id: string) => void;
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
          selectedId={selectedId}
          onPick={onPick}
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
  selectedId,
  onPick,
}: {
  shape: BottleShape;
  items: SceneBottle[];
  rows: number;
  cols: number;
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  const { invalidate } = useThree();
  const glass = useRef<THREE.InstancedMesh>(null);
  const label = useRef<THREE.InstancedMesh>(null);
  const foil = useRef<THREE.InstancedMesh>(null);
  const pull = useRef({ id: null as string | null, value: 0 });

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
    return (item: SceneBottle, extra: number): THREE.Matrix4 => {
      const [x, y, z] = slotPosition(item.row, item.col, rows, cols);
      dummy.position.set(x, y, z + extra);
      dummy.rotation.set(Math.PI / 2 - TILT, 0, 0);
      dummy.updateMatrix();
      return out.copy(dummy.matrix).multiply(local);
    };
  }, [rows, cols]);

  const colour = useMemo(() => new THREE.Color(), []);
  const writeAll = () => {
    const meshes = [glass.current, label.current, foil.current];
    if (meshes.some((m) => !m)) return;
    items.forEach((item, i) => {
      const lift = item.id === pull.current.id ? pull.current.value : 0;
      const m = place(item, lift);
      for (const mesh of meshes) mesh!.setMatrixAt(i, m);
      colour.set(GLASS[item.type]);
      // The chosen bottle glows in its own hue (mixing towards white would turn a red bottle grey).
      if (item.id === selectedId) colour.offsetHSL(0, 0.08, 0.14);
      glass.current!.setColorAt(i, colour);
      label.current!.setColorAt(i, colour.set(LABEL));
      foil.current!.setColorAt(i, colour.set(FOIL[item.type]));
    });
    for (const mesh of meshes) {
      mesh!.instanceMatrix.needsUpdate = true;
      if (mesh!.instanceColor) mesh!.instanceColor.needsUpdate = true;
    }
    invalidate();
  };

  useLayoutEffect(() => {
    // A new choice: the previous bottle slides home at once, the new one eases out (see useFrame).
    pull.current = {
      id: selectedId,
      value: pull.current.id === selectedId ? pull.current.value : 0,
    };
    writeAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, rows, cols, selectedId, place]);

  useFrame((_, delta) => {
    const p = pull.current;
    if (!p.id) return;
    const index = items.findIndex((b) => b.id === p.id);
    if (index < 0 || Math.abs(PULL - p.value) < 0.002) return;
    p.value += (PULL - p.value) * Math.min(1, delta * 12);
    const m = place(items[index]!, p.value);
    for (const mesh of [glass.current, label.current, foil.current]) {
      mesh?.setMatrixAt(index, m);
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    }
    invalidate();
  });

  const count = items.length;
  return (
    <group>
      <instancedMesh
        ref={glass}
        args={[geometries.body, materials.glass, count]}
        frustumCulled={false}
        onClick={(e) => {
          e.stopPropagation();
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
