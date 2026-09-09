import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { C } from "../palette";
import { LAYER_GAP, smooth } from "../coverage";
import { featurePosition } from "../geometry";
import { modelsFor, useStore } from "../store";
import { Stack } from "./Stack";
import type { ModelId, View } from "../types";

const STACK_SPREAD = 7.5;

export function offsetFor(view: View, model: ModelId): number {
  if (view !== "compare") return 0;
  return model === "gemma-2-2b" ? -STACK_SPREAD : STACK_SPREAD;
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
}: {
  height: number;
  halfWidth: number;
  focusY: number | null;
  /** changing this re-runs the ease, which is how "reset view" works */
  nonce: number;
}) {
  const { camera, controls } = useThree();
  const fromPos = useRef(new THREE.Vector3());
  const fromTarget = useRef(new THREE.Vector3());
  const t = useRef(1);

  const [goalPos, goalTarget] = useMemo(() => {
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
  }, [focusY, height, halfWidth, camera, nonce]);

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
  const view = useStore((s) => s.view);
  const counterpart = useStore((s) => s.counterpart);

  const found = useMemo(() => {
    if (!hovered) return null;
    for (const m of modelsFor(view)) {
      const f = results[m]?.features.find((x) => x.id === hovered);
      if (f) return { f, xOffset: offsetFor(view, m) };
    }
    const c = counterpart?.features.find((x) => x.id === hovered);
    if (c && counterpart) return { f: c, xOffset: offsetFor(view, counterpart.target) };
    return null;
  }, [hovered, results, view, counterpart]);

  if (!found) return null;
  const { f, xOffset } = found;

  return (
    <Html position={featurePosition(f, xOffset)} style={{ pointerEvents: "none" }}>
      <div className="node-label">
        <span className="node-label-loc">layer {f.layer} · feature #{f.index}</span>
        {f.description}
      </div>
    </Html>
  );
}

export function Scene() {
  const manifest = useStore((s) => s.manifest);
  const view = useStore((s) => s.view);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" && !(e.target instanceof HTMLInputElement)) resetCamera();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resetCamera]);

  const models = modelsFor(view);
  const anyResults = models.some((m) => (results[m]?.features.length ?? 0) > 0);
  const nLayers = manifest ? Math.max(...models.map((m) => manifest.models[m].n_layers)) : 26;
  const height = nLayers * LAYER_GAP;
  const halfWidth = view === "compare" ? STACK_SPREAD + 4.2 : 4.2;

  return (
    <Canvas
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
      <OrbitControls makeDefault enableDamping dampingFactor={0.06} minDistance={4} maxDistance={90} />
      <Camera
        height={height}
        halfWidth={halfWidth}
        focusY={isolated === null ? null : isolated * LAYER_GAP}
        nonce={frameNonce}
      />
      <IdleSpin active={!anyResults && isolated === null} />

      {manifest &&
        models.map((m) => (
          <Stack
            key={m}
            model={m}
            nLayers={manifest.models[m].n_layers}
            display={manifest.models[m].display}
            xOffset={offsetFor(view, m)}
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
