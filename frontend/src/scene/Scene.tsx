import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { C } from "../palette";
import { LAYER_GAP, smooth } from "../coverage";
import { GLOBE_RADIUS, featurePosition, globeLatitude } from "../geometry";
import { useStore } from "../store";
import { progressFraction } from "../search";
import { Stack } from "./Stack";
import type { ModelId, Shape } from "../types";

const STACK_SPREAD = 7.5;
const GLOBE_SPREAD = GLOBE_RADIUS + 3.2;

export function spreadFor(shape: Shape): number {
  return shape === "globe" ? GLOBE_SPREAD : STACK_SPREAD;
}

/**
 * Where a model's stack stands. One model sits at the origin; several are laid
 * out symmetrically about it in the order they were picked, so adding a third
 * model widens the scene rather than reshuffling the two already on screen.
 */
export function offsetFor(models: ModelId[], model: ModelId, shape: Shape = "stack"): number {
  const n = models.length;
  if (n < 2) return 0;
  const i = models.indexOf(model);
  return (i - (n - 1) / 2) * spreadFor(shape) * (n > 2 ? 1.5 : 1);
}

/** Slow drift while nothing is searched; stops the moment results land. */
function IdleSpin({ active }: { active: boolean }) {
  const { camera, controls } = useThree();
  useFrame((_, dt) => {
    const c = controls as { target: THREE.Vector3; update: () => void } | null;
    if (!active || !c) return;
    const a = dt * 0.05;
    const dx = camera.position.x - c.target.x;
    const dz = camera.position.z - c.target.z;
    camera.position.x = c.target.x + dx * Math.cos(a) - dz * Math.sin(a);
    camera.position.z = c.target.z + dx * Math.sin(a) + dz * Math.cos(a);
    c.update();
  });
  return null;
}

/**
 * Camera choreography. Nothing ever teleports: framing the whole stack and
 * flying to a single layer are the same 700 ms ease, just to different goals.
 */
function Camera({
  height,
  halfWidth,
  focusY,
  nonce,
  shape,
  focusLayer,
  nLayers,
}: {
  height: number;
  halfWidth: number;
  focusY: number | null;
  /** changing this re-runs the ease, which is how "reset view" works */
  nonce: number;
  shape: Shape;
  focusLayer: number | null;
  nLayers: number;
}) {
  const { camera, controls } = useThree();
  const fromPos = useRef(new THREE.Vector3());
  const fromTarget = useRef(new THREE.Vector3());
  const t = useRef(1);

  const [goalPos, goalTarget] = useMemo(() => {
    if (shape === "globe") {
      if (focusLayer !== null) {
        // look at the ring from just outside the globe, level with it
        const lat = globeLatitude(focusLayer, nLayers);
        const y = Math.sin(lat) * GLOBE_RADIUS;
        return [new THREE.Vector3(0, y * 1.15, GLOBE_RADIUS + 9), new THREE.Vector3(0, y, 0)];
      }
      const fov = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
      const aspect = (camera as THREE.PerspectiveCamera).aspect || 1.6;
      const forWidth = (halfWidth + 2) / Math.tan(fov / 2) / aspect;
      const forHeight = (GLOBE_RADIUS + 2) / Math.tan(fov / 2);
      return [new THREE.Vector3(0, GLOBE_RADIUS * 0.35, Math.max(forWidth, forHeight)), new THREE.Vector3(0, 0, 0)];
    }
    if (focusY !== null) {
      // close in on one layer, slightly above it so the blocks read
      return [
        new THREE.Vector3(0, focusY + LAYER_GAP * 1.4, halfWidth + 8),
        new THREE.Vector3(0, focusY + LAYER_GAP * 0.4, 0),
      ];
    }
    // frame the whole thing: pull back far enough for both height and width
    const fov = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
    const aspect = (camera as THREE.PerspectiveCamera).aspect || 1.6;
    const forHeight = (height / 2) * 1.28 / Math.tan(fov / 2);
    const forWidth = (halfWidth + 4) / Math.tan(fov / 2) / aspect;
    const dist = Math.max(forHeight, forWidth);
    return [
      new THREE.Vector3(0, height * 0.5, dist),
      new THREE.Vector3(0, height * 0.5, 0),
    ];
  }, [focusY, height, halfWidth, camera, nonce, shape, focusLayer, nLayers]);

  useEffect(() => {
    const c = controls as { target: THREE.Vector3 } | null;
    fromPos.current.copy(camera.position);
    fromTarget.current.copy(c?.target ?? new THREE.Vector3());
    t.current = 0;
  }, [goalPos, goalTarget, camera, controls]);

  useFrame((_, dt) => {
    if (t.current >= 1) return;
    const c = controls as { target: THREE.Vector3; update: () => void } | null;
    t.current = Math.min(1, t.current + dt / 0.7);
    const e = smooth(t.current);
    camera.position.lerpVectors(fromPos.current, goalPos, e);
    c?.target.lerpVectors(fromTarget.current, goalTarget, e);
    c?.update();
  });

  return null;
}

/** The description of the feature under the cursor, floating beside it. */
function HoverLabel() {
  const hovered = useStore((s) => s.hovered);
  const results = useStore((s) => s.results);
  const selected = useStore((s) => s.selected);
  const counterpart = useStore((s) => s.counterpart);
  const shape = useStore((s) => s.shape);
  const catalog = useStore((s) => s.catalog);

  const found = useMemo(() => {
    if (!hovered) return null;
    for (const m of selected) {
      const f = results[m]?.features.find((x) => x.id === hovered);
      if (f) return { f, xOffset: offsetFor(selected, m, shape) };
    }
    const c = counterpart?.features.find((x) => x.id === hovered);
    if (c && counterpart) return { f: c, xOffset: offsetFor(selected, counterpart.target, shape) };
    return null;
  }, [hovered, results, selected, counterpart, shape]);

  if (!found) return null;
  const { f, xOffset } = found;
  const nLayers = catalog?.models[f.model].nLayers ?? 26;

  return (
    <Html zIndexRange={[10, 0]} position={featurePosition(f, xOffset, shape, nLayers)} style={{ pointerEvents: "none" }}>
      <div className="node-label">
        <span className="node-label-loc">layer {f.layer} · feature #{f.index}</span>
        {f.description}
      </div>
    </Html>
  );
}

export function Scene() {
  const catalog = useStore((s) => s.catalog);
  const selected = useStore((s) => s.selected);
  const results = useStore((s) => s.results);
  const generation = useStore((s) => s.generation);
  const isolated = useStore((s) => s.isolated);
  const hovered = useStore((s) => s.hovered);
  const hoveredLayer = useStore((s) => s.hoveredLayer);
  const setHovered = useStore((s) => s.setHovered);
  const setHoveredLayer = useStore((s) => s.setHoveredLayer);
  const toggleIsolated = useStore((s) => s.toggleIsolated);
  const resetCamera = useStore((s) => s.resetCamera);
  const frameNonce = useStore((s) => s.frameNonce);
  const counterpart = useStore((s) => s.counterpart);
  const findCounterpart = useStore((s) => s.findCounterpart);
  const shape = useStore((s) => s.shape);
  const drag = useStore((s) => s.drag);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" && !(e.target instanceof HTMLInputElement)) resetCamera();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resetCamera]);

  const models = selected;
  // While the index is arriving the stack is drawn as far as the bytes have
  // got: the thing being waited for assembles itself, one layer at a time,
  // instead of a spinner standing in front of an empty screen.
  const reveal = progressFraction(useStore((s) => s.load));
  const drawnLayers = (n: number) => (reveal >= 1 ? n : Math.max(1, Math.ceil(reveal * n)));
  const anyResults = models.some((m) => (results[m]?.features.length ?? 0) > 0);
  const nLayers = catalog && models.length ? Math.max(...models.map((m) => catalog.models[m].nLayers)) : 26;
  const height = nLayers * LAYER_GAP;
  const halfWidth =
    shape === "globe"
      ? (models.length > 1 ? GLOBE_SPREAD * (models.length - 1) * 0.75 : 0) + GLOBE_RADIUS + 1
      : models.length > 1
        ? STACK_SPREAD * (models.length - 1) * (models.length > 2 ? 0.9 : 0.6) + 4.2
        : 4.2;

  return (
    <Canvas
      className={drag === "pan" ? "grab-mode" : undefined}
      camera={{ position: [0, 17.5, 54], fov: 45 }}  // close to the framing shot, so frame one is already right
      dpr={[1, 1.75]}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color(C.VOID);
      }}
      onPointerMissed={(e) => {
        setHovered(null);
        if (e.type === "dblclick") resetCamera();
        else toggleIsolated(null);
      }}
      onDoubleClick={() => resetCamera()}
    >
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.06}
        minDistance={4}
        maxDistance={90}
        screenSpacePanning
        panSpeed={1.1}
        // grab mode swaps the buttons: left drags the model across the screen, right turns it
        mouseButtons={{
          LEFT: drag === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: drag === "pan" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
        }}
        touches={{ ONE: drag === "pan" ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
      <Camera
        height={height}
        halfWidth={halfWidth}
        focusY={isolated === null ? null : isolated * LAYER_GAP}
        nonce={frameNonce}
        shape={shape}
        focusLayer={isolated}
        nLayers={nLayers}
      />
      <IdleSpin active={!anyResults && isolated === null} />

      {catalog &&
        models.map((m: string) => (
          <Stack
            key={m}
            model={m}
            nLayers={drawnLayers(catalog.models[m].nLayers)}
            totalLayers={catalog.models[m].nLayers}
            display={catalog.models[m].display}
            xOffset={offsetFor(selected, m, shape)}
            shape={shape}
            features={results[m]?.features ?? []}
            generation={generation}
            isolated={isolated}
            hovered={hovered}
            hoveredLayer={hoveredLayer}
            onHover={setHovered}
            onHoverLayer={setHoveredLayer}
            onPickLayer={toggleIsolated}
            onPick={(id) => void findCounterpart(id)}
            sourceId={counterpart?.source.model === m ? counterpart.source.id : null}
            counterparts={counterpart?.target === m ? counterpart.features : []}
          />
        ))}

      <HoverLabel />
    </Canvas>
  );
}
