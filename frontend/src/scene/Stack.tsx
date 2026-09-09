import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { C } from "../palette";
import { nodePosition, smooth } from "../coverage";
import { CLUSTER_COLOURS, featurePosition } from "../geometry";
import { Architecture } from "./Architecture";
import type { Feature } from "../types";

const SCAFFOLD_PER_LAYER = 200;
const IGNITE_MS = 320;
const LAYER_STAGGER_MS = 25;

/**
 * Faint dots for features that exist and did not match — so the lit ones read
 * as a few out of many. Synthetic indices keep them off real feature positions.
 */
function Scaffold({ model, nLayers, xOffset }: { model: string; nLayers: number; xOffset: number }) {
  const geometry = useMemo(() => {
    const arr = new Float32Array(nLayers * SCAFFOLD_PER_LAYER * 3);
    let o = 0;
    for (let L = 0; L < nLayers; L++) {
      for (let i = 0; i < SCAFFOLD_PER_LAYER; i++) {
        const [x, y, z] = nodePosition(model, L, 1_000_000 + i, xOffset);
        arr[o++] = x;
        arr[o++] = y;
        arr[o++] = z;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, [model, nLayers, xOffset]);

  return (
    <points geometry={geometry}>
      <pointsMaterial color={C.SCAFFOLD} size={0.075} sizeAttenuation transparent opacity={0.95} />
    </points>
  );
}

interface MatchedProps {
  model: string;
  features: Feature[];
  xOffset: number;
  generation: number;
  isolated: number | null;
  hovered: string | null;
  onHover: (id: string | null) => void;
  /** clicking a lit feature asks for its counterpart in the other model */
  onPick?: (id: string) => void;
  /** feature id whose counterparts are being shown; drawn in the accent colour */
  sourceId?: string | null;
  /** override every node's colour (used for the counterpart overlay) */
  tint?: string;
}

/**
 * The lit features. One instanced mesh, one useFrame — the ignition cascade is
 * a per-instance delay read in the frame loop, never a spring per node.
 */
function Matched({ model, features, xOffset, generation, isolated, hovered, onHover, onPick, sourceId, tint }: MatchedProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const start = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colour = useMemo(() => new THREE.Color(), []);
  const accent = useMemo(() => new THREE.Color(C.YELLOW), []);
  const palette = useMemo(() => {
    const p: Record<string, THREE.Color> = { base: new THREE.Color(tint ?? C.BLUE) };
    CLUSTER_COLOURS.forEach((c, i) => (p[i] = new THREE.Color(c)));
    return p;
  }, [tint]);

  const layout = useMemo(() => {
    start.current = 0;
    return features.map((f) => ({
      pos: featurePosition(f, xOffset),
      delay: f.layer * LAYER_STAGGER_MS,
      rel: f.rel,
      id: f.id,
      layer: f.layer,
      colour: tint === undefined && f.cluster !== undefined ? palette[f.cluster] : palette.base,
    }));
    // generation forces a fresh cascade even when the same features come back
  }, [features, model, xOffset, generation, tint, palette]);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m || layout.length === 0) return;
    const now = clock.elapsedTime * 1000;
    if (start.current === 0) start.current = now;
    const t = now - start.current;

    for (let i = 0; i < layout.length; i++) {
      const n = layout[i];
      const p = Math.max(0, Math.min(1, (t - n.delay) / IGNITE_MS));
      const grow = smooth(p);
      const isHovered = hovered === n.id || sourceId === n.id;
      const dimmed = isolated !== null && isolated !== n.layer;

      const radius = 0.06 * (0.6 + 0.8 * n.rel) * (isHovered ? 1.6 : 1);
      dummy.position.set(n.pos[0], n.pos[1], n.pos[2]);
      dummy.scale.setScalar(radius * grow * (dimmed ? 0.6 : 1));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);

      const brightness = (0.4 + 0.6 * n.rel) * grow * (dimmed ? 0.08 : 1);
      colour.copy(isHovered ? accent : n.colour).multiplyScalar(brightness);
      m.setColorAt(i, colour);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  if (layout.length === 0) return null;

  return (
    <instancedMesh
      ref={mesh}
      key={`${model}-${layout.length}-${generation}`}
      args={[undefined, undefined, layout.length]}
      frustumCulled={false}
      onPointerMove={(e) => {
        e.stopPropagation();
        if (e.instanceId !== undefined) onHover(layout[e.instanceId]?.id ?? null);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (onPick && e.instanceId !== undefined) {
          const id = layout[e.instanceId]?.id;
          if (id) onPick(id);
        }
      }}
    >
      <sphereGeometry args={[1, 10, 10]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

export interface StackProps extends MatchedProps {
  /** the other model's analogues of the picked feature, drawn on this stack in gold */
  counterparts: Feature[];
  nLayers: number;
  display: string;
  hoveredLayer: number | null;
  onHoverLayer: (layer: number | null) => void;
  onPickLayer: (layer: number) => void;
}

export function Stack({
  counterparts,
  nLayers,
  display,
  hoveredLayer,
  onHoverLayer,
  onPickLayer,
  ...rest
}: StackProps) {
  return (
    <group>
      <Architecture
        nLayers={nLayers}
        xOffset={rest.xOffset}
        label={display}
        isolated={rest.isolated}
        hoveredLayer={hoveredLayer}
        onHoverLayer={onHoverLayer}
        onPickLayer={onPickLayer}
      />
      <Scaffold model={rest.model} nLayers={nLayers} xOffset={rest.xOffset} />
      <Matched {...rest} />
      {counterparts.length > 0 && (
        <Matched
          {...rest}
          features={counterparts}
          tint={C.GOLD}
          onPick={undefined}
          sourceId={null}
          generation={rest.generation + 1000}
        />
      )}
    </group>
  );
}
