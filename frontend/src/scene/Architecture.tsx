import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { C } from "../palette";
import { DISC_RADIUS, LAYER_GAP } from "../coverage";
import { useStore } from "../store";

/**
 * The transformer itself, drawn the way 3Blue1Brown draws it: a residual stream
 * running bottom to top, and at every layer the two detours the data takes —
 * attention out to the left, MLP out to the right, each rejoining the stream.
 *
 * Every line in here lives in ONE merged LineSegments geometry with vertex
 * colours (brightness stands in for opacity on a black background), so the whole
 * architecture costs a single draw call no matter how many layers it has.
 */

const BRANCH_X = 1.55;   // how far the detours swing off the residual stream
const ATTN_R = 0.26;     // attention glyph half-size (a lens)
const MLP_R = 0.2;       // MLP glyph half-size (a square)
const EMBED_DROP = 1.6;  // how far below layer 0 the token row sits

type Push = (
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  hex: string, brightness: number
) => void;

function makePusher(pos: number[], col: number[]): Push {
  const c = new THREE.Color();
  return (ax, ay, az, bx, by, bz, hex, brightness) => {
    pos.push(ax, ay, az, bx, by, bz);
    c.set(hex).multiplyScalar(brightness);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  };
}

/** Closed outline through a list of XY points, at depth z = 0. */
function outline(push: Push, pts: [number, number][], hex: string, b: number) {
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    push(x1, y1, 0, x2, y2, 0, hex, b);
  }
}

/** Polyline (open) through a list of XY points. */
function path(push: Push, pts: [number, number][], hex: string, b: number) {
  for (let i = 0; i < pts.length - 1; i++) {
    push(pts[i][0], pts[i][1], 0, pts[i + 1][0], pts[i + 1][1], 0, hex, b);
  }
}

/** The two detours, their glyphs and their junctions, for one layer at y = 0. */
function pushLayerBlock(push: Push, hex: string, b: number) {
  const attnOut = 0.10 * LAYER_GAP;
  const attnIn = 0.38 * LAYER_GAP;
  const mlpOut = 0.52 * LAYER_GAP;
  const mlpIn = 0.80 * LAYER_GAP;
  const attnY = (attnOut + attnIn) / 2;
  const mlpY = (mlpOut + mlpIn) / 2;

  // attention detour: leave the stream, through the block, rejoin
  path(push, [[0, attnOut], [-BRANCH_X, attnOut], [-BRANCH_X, attnIn], [0, attnIn]], hex, b * 0.7);
  // MLP detour, mirrored
  path(push, [[0, mlpOut], [BRANCH_X, mlpOut], [BRANCH_X, mlpIn], [0, mlpIn]], hex, b * 0.7);

  // attention = a lens (two points, two curves) — tokens looking at each other
  outline(push, [
    [-BRANCH_X, attnY + ATTN_R],
    [-BRANCH_X + ATTN_R * 0.8, attnY],
    [-BRANCH_X, attnY - ATTN_R],
    [-BRANCH_X - ATTN_R * 0.8, attnY],
  ], hex, b);

  // MLP = a square — the per-token feed-forward
  outline(push, [
    [BRANCH_X - MLP_R, mlpY - MLP_R],
    [BRANCH_X + MLP_R, mlpY - MLP_R],
    [BRANCH_X + MLP_R, mlpY + MLP_R],
    [BRANCH_X - MLP_R, mlpY + MLP_R],
  ], hex, b);

  // residual junctions: a "+" where each detour is added back in
  for (const jy of [attnIn, mlpIn]) {
    push(-0.09, jy, 0, 0.09, jy, 0, hex, b * 1.2);
    push(0, jy - 0.09, 0, 0, jy + 0.09, 0, hex, b * 1.2);
  }
}

/** One layer, lit on its own — used for the hovered / isolated highlight. */
export function buildLayerHighlight(hex: string): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const push = makePusher(pos, col);
  pushLayerBlock(push, hex, 1);
  for (let i = 0; i < 64; i++) {
    const a1 = (i / 64) * Math.PI * 2;
    const a2 = ((i + 1) / 64) * Math.PI * 2;
    push(
      Math.cos(a1) * DISC_RADIUS, 0, Math.sin(a1) * DISC_RADIUS,
      Math.cos(a2) * DISC_RADIUS, 0, Math.sin(a2) * DISC_RADIUS,
      hex, 0.9
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function buildGeometry(nLayers: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const push = makePusher(pos, col);

  const top = (nLayers - 1) * LAYER_GAP;

  // --- layer rims: the boundary of each layer's feature space ------------
  for (let L = 0; L < nLayers; L++) {
    const y = L * LAYER_GAP;
    for (let i = 0; i < 64; i++) {
      const a1 = (i / 64) * Math.PI * 2;
      const a2 = ((i + 1) / 64) * Math.PI * 2;
      push(
        Math.cos(a1) * DISC_RADIUS, y, Math.sin(a1) * DISC_RADIUS,
        Math.cos(a2) * DISC_RADIUS, y, Math.sin(a2) * DISC_RADIUS,
        C.STRUCTURE, 0.6
      );
    }
  }

  // --- residual stream --------------------------------------------------
  push(0, -EMBED_DROP * 0.45, 0, 0, top + LAYER_GAP * 0.9, 0, C.STRUCTURE, 0.85);

  // --- per-layer blocks -------------------------------------------------
  for (let L = 0; L < nLayers; L++) {
    const y = L * LAYER_GAP;
    const at = pos.length;
    pushLayerBlock(push, C.STRUCTURE, 1);
    // shift the freshly-pushed block up to this layer's height
    for (let i = at + 1; i < pos.length; i += 3) pos[i] += y;
  }

  // --- embedding: tokens entering the stream ----------------------------
  const tokens = 7;
  const spanX = 2.4;
  for (let i = 0; i < tokens; i++) {
    const x = -spanX + (i / (tokens - 1)) * spanX * 2;
    const yTop = -EMBED_DROP * 0.75;
    const yBot = -EMBED_DROP * 1.15;
    // each token is a short vertical bar: an embedding vector
    push(x, yBot, 0, x, yTop, 0, C.STRUCTURE, 0.9);
    // funnelling into the residual stream
    path(push, [[x, yTop], [0, -EMBED_DROP * 0.45]], C.STRUCTURE, 0.35);
  }

  // --- unembedding: back out to vocabulary ------------------------------
  const capY = top + LAYER_GAP * 0.9;
  for (let i = 0; i < tokens; i++) {
    const x = -spanX + (i / (tokens - 1)) * spanX * 2;
    path(push, [[0, capY], [x, capY + LAYER_GAP * 0.55]], C.STRUCTURE, 0.35);
    push(x, capY + LAYER_GAP * 0.55, 0, x, capY + LAYER_GAP * 0.85, 0, C.STRUCTURE, 0.9);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** A bright dash travelling the residual stream — the signal moving upward. */
function Signal({ nLayers }: { nLayers: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const height = (nLayers - 1) * LAYER_GAP + LAYER_GAP * 1.9;
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.elapsedTime % 6) / 6;
    ref.current.position.y = -EMBED_DROP * 0.45 + t * height;
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.5 * Math.sin(Math.PI * Math.min(1, t / 0.98));
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[0.035, 0.5, 0.035]} />
      <meshBasicMaterial color={C.BLUE} transparent opacity={0} toneMapped={false} />
    </mesh>
  );
}

interface ArchitectureProps {
  nLayers: number;
  xOffset: number;
  label: string;
  isolated: number | null;
  hoveredLayer: number | null;
  onHoverLayer: (layer: number | null) => void;
  onPickLayer: (layer: number) => void;
}

export function Architecture({
  nLayers,
  xOffset,
  label,
  isolated,
  hoveredLayer,
  onHoverLayer,
  onPickLayer,
}: ArchitectureProps) {
  const geometry = useMemo(() => buildGeometry(nLayers), [nLayers]);
  const highlight = useMemo(() => buildLayerHighlight(C.YELLOW), []);
  const top = (nLayers - 1) * LAYER_GAP;
  const active = isolated ?? hoveredLayer;
  const compare = useStore((s) => s.view) === "compare";

  return (
    <group position={[xOffset, 0, 0]}>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={isolated === null ? 1 : 0.22}
        />
      </lineSegments>

      {/* the layer you are pointing at, drawn again in full */}
      {active !== null && (
        <lineSegments geometry={highlight} position={[0, active * LAYER_GAP, 0]}>
          <lineBasicMaterial vertexColors transparent opacity={0.95} />
        </lineSegments>
      )}

      {/* invisible pick targets: one flat ring per layer, so the stack itself
          is the layer control as much as the tick column is */}
      {Array.from({ length: nLayers }, (_, L) => (
        <mesh
          key={L}
          visible={false}
          position={[0, L * LAYER_GAP + LAYER_GAP * 0.45, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          onPointerOver={(e) => {
            e.stopPropagation();
            onHoverLayer(L);
          }}
          onPointerOut={() => onHoverLayer(null)}
          onClick={(e) => {
            e.stopPropagation();
            onPickLayer(L);
          }}
        >
          <ringGeometry args={[0.1, DISC_RADIUS, 24]} />
          <meshBasicMaterial side={THREE.DoubleSide} />
        </mesh>
      ))}

      <Signal nLayers={nLayers} />

      {/* Labels sit next to the thing they label, no boxes. In Compare the two
          stacks overlap on screen, and one set of anatomy labels per stack means
          ten pieces of small grey text over two point clouds — so there the
          model keeps its name and gives up the rest. The schematic inset in the
          corner still explains a layer. */}
      {!compare && (
        <>
          <Html position={[-BRANCH_X - 0.5, 0.24 * LAYER_GAP, 0]} style={{ pointerEvents: "none" }}>
            <div className="scene-label right">attention</div>
          </Html>
          <Html position={[BRANCH_X + 0.45, 0.66 * LAYER_GAP, 0]} style={{ pointerEvents: "none" }}>
            <div className="scene-label">mlp</div>
          </Html>
          <Html position={[0, -EMBED_DROP * 1.45, 0]} style={{ pointerEvents: "none" }}>
            <div className="scene-label centre">tokens in</div>
          </Html>
          <Html position={[0.16, top * 0.5, 0]} style={{ pointerEvents: "none" }}>
            <div className="scene-label">residual stream</div>
          </Html>
        </>
      )}
      <Html position={[0, top + LAYER_GAP * 2.1, 0]} style={{ pointerEvents: "none" }}>
        <div className="scene-label centre">{label} · {nLayers} layers</div>
      </Html>
    </group>
  );
}
