# VISUAL DIRECTION — RoamerAI

**One rule above all others: the screen is black, and the model is the only thing in it.**

Every pixel that isn't the transformer has to justify itself. No panels, no cards, no borders, no drop shadows, no rounded containers, no gradients. Text floats directly on the void. When something isn't needed right now, it isn't on screen — it fades in when it becomes relevant and fades out when it stops.

This is the 3Blue1Brown discipline, borrowed as *conventions*, not assets: pure black background, a small meaningful palette, thin strokes, labels attached to the thing they label, and motion that carries meaning rather than decorating. We're reimplementing that language in WebGL — no Manim code, no copied artwork.

---

## 1. Palette

Taken from Manim's color constants (MIT-licensed library, values verified against the current docs). Use these exact hex values and nothing else.

```ts
export const C = {
  VOID:      "#000000",  // background. Pure black. Never #0b0f1a, never a dark blue.
  SCAFFOLD:  "#222222",  // GREY_E   — unmatched features, barely there
  STRUCTURE: "#444444",  // GREY_D   — layer disc rims, axis line
  MUTED:     "#888888",  // GREY_C   — secondary text
  TEXT:      "#DDDDDD",  // GREY_A   — primary text
  WHITE:     "#FFFFFF",  // overlap / peak emphasis only

  BLUE:      "#58C4DD",  // BLUE_C   — concept slot 1 (default)
  BLUE_DEEP: "#29ABCA",  // BLUE_D   — its dim state
  YELLOW:    "#FFFF00",  // YELLOW_C — emphasis: the thing being pointed at, right now
  RED:       "#FC6255",  // RED_C    — concept slot 2
  GREEN:     "#83C167",  // GREEN_C  — concept slot 3
  TEAL:      "#5CD0B3",  // TEAL_C   — live token activations (sentence tab)
  GOLD:      "#F0AC5F",  // GOLD_C   — reserve; layer-isolation highlight
} as const;
```

**Meaning assignments — do not improvise past these:**

| Color | Means |
|---|---|
| `SCAFFOLD` | a feature exists here and did not match |
| `BLUE` / `RED` / `GREEN` | concept slots 1, 2, 3 — assigned in pin order, never reassigned |
| `TEAL` | this feature actually fired on the sentence you ran |
| `YELLOW` | the one thing the user is touching right now: hovered node, selected layer, active token |
| `WHITE` | a node matched by more than one pinned concept, or a peak activation |
| `TEXT`/`MUTED` | text only, never geometry |

Color encodes **concept**, never model. In Compare, the two models are told apart by position and by stack height (26 discs vs 32) — labeled once in text.

---

## 2. The void

- `<Canvas>` fills the viewport. `scene.background = new THREE.Color(0x000000)`. No fog, no environment map, no skybox, no ground plane.
- No CSS anywhere with a background color other than transparent or `#000000`. If you find yourself drawing a box around something, delete the box.
- Vignette is allowed only if it's pure black at the edges (it costs a pass; skip it unless free).
- HUD text renders in absolutely positioned DOM over the canvas, `pointer-events: none` except on actual controls. Typeface: `ui-sans-serif, Inter, system-ui`. Sizes: 11px (`MUTED`, uppercase, `letter-spacing: 0.08em`) for labels, 14px for body, 56px for the coverage score. Numbers use `font-variant-numeric: tabular-nums` so they don't jitter while updating.

---

## 3. The model

The transformer is a **vertical stack**, layer 0 at the bottom, reading upward like a signal traveling through the network.

| Element | Look |
|---|---|
| Layer disc | No fill. A `LineLoop` ring at radius 4 in `STRUCTURE`, opacity 0.35, 64 segments. That's it — a wireframe rim, not a plate. |
| Spine | A single vertical line in `STRUCTURE` at opacity 0.2 through the center of the stack. It reads as the residual stream. |
| Layer label | `L0`, `L5`, `L10`… floating just outside the ring at the same height, 11px, `MUTED`, opacity 0.4. On hover/selection: `YELLOW`, opacity 1, and it shows the full label (`Layer 12 · 16,384 features · 31 matched`). |
| Scaffold features | 200 points per layer, `SCAFFOLD`, size ~1.5px, opacity 0.5. Present so the lit ones read as *a few out of many*. Never clickable. |
| Matched feature | Sphere r=0.06, `MeshBasicMaterial` in the concept color, plus a small additive sprite halo. Radius `0.6 + 0.8·rel`, brightness `0.4 + 0.6·rel`. |
| Beam (sentence tab) | Thin `Line` in `TEAL`, opacity 0.35, with a bright dash traveling along it. |

No lights, no `MeshStandardMaterial`, no shadows. Everything is emissive-flat, like ink on black. This is both the correct aesthetic and the fastest possible render.

---

## 4. Motion language

Manim's grammar: things **fade in** rather than appear, **transform** rather than swap, and grouped elements animate with a **stagger** so the eye can follow the order.

```ts
// quintic smootherstep — the default easing for everything
export const smooth = (t: number) => t * t * t * (t * (6 * t - 15) + 10);
```

| Motion | Spec |
|---|---|
| **Ignition cascade** | New results light bottom layer → top. 25 ms stagger per layer, ~500 ms total. Each node: scale 0 → 1 and opacity 0 → 1 on `smooth`. Implement as one `useFrame` reading a per-instance `delay` attribute — never one spring per node. |
| **Signal pulse** | When idle (no input for 4 s), a faint ring sweeps the stack bottom to top every 6 s, briefly brightening lit nodes as it passes (a single `pulseY` uniform; nodes brighten by `exp(-((y-pulseY)/0.35)²)`). Stops the instant the user interacts. |
| **Camera fly-to** | Click a layer ring, a bar, or drag the slider → camera position and target ease to that layer over 700 ms on `smooth`, then `OrbitControls` regains control. Never teleport. |
| **Token beams** | On token click, beams draw themselves from the token upward to each matched node over 400 ms, staggered 15 ms apart, in ascending layer order. A dash travels each beam continuously afterward. |
| **Fade out** | Previous results don't vanish; they fade to `SCAFFOLD` over 250 ms while the new ones ignite. The dissolve *is* the transition. |
| **Text** | Numbers tween to their new value over 400 ms (`smooth`) rather than snapping. Labels cross-fade at 150 ms. |

Everything above respects `prefers-reduced-motion` and a `motion` toggle in the store: when off, states change instantly, nothing loops.

---

## 5. Everything is interactive

Full orbit: **left-drag rotate, scroll zoom, right-drag pan**. `enableDamping: true`, `dampingFactor: 0.06`, `minDistance: 3`, `maxDistance: 60`. Double-click empty space resets the camera to the framing shot over 700 ms.

| Target | Hover | Click |
|---|---|---|
| Matched feature node | Scales ×1.4, turns `YELLOW`, its description appears as floating text beside it (no box, no arrow, no background) | Opens the detail drawer; the node stays `YELLOW` and pinned while open |
| Layer ring | Ring brightens to `YELLOW` 0.6; label expands to the full string | Isolates that layer: other layers fade to 8%, camera flies to it, panel lists that layer's matches. Click again to release. |
| Layer label | same as ring | same as ring |
| Per-layer bar | Bar turns `YELLOW`; matching layer's ring highlights in 3D simultaneously | Same as clicking that ring — the bar chart and the 3D stack are the same control |
| Token chip | Chip text goes `YELLOW` | Selects the token: beams draw, non-matching nodes dim to 15% |
| Pinned concept chip | Its color brightens; that concept's nodes brighten, others dim | Toggles that concept's visibility; × removes it |
| Empty space | — | Deselects everything, restores full view |

Cursor: `grab` over the canvas, `grabbing` while dragging, `pointer` over any hoverable target. Hover detection uses a raycast against **lit nodes only** (≤250 instances), throttled to ~30 Hz — never raycast the scaffold points.

Keyboard: `/` focuses search · `1`/`2`/`3` switch model/model/compare · `f`/`d` fast/deep · `Esc` closes the drawer, then deselects · `↑`/`↓` step through layers · `Space` toggles idle pulse · `r` resets camera.

---

## 6. HUD layout — text floating on black

```
 ROAMERAI                                     SEARCH A CONCEPT  ·  run a sentence        ?

 ─────────────────────────────────────
  protein folding                                        fast · DEEP        gemma · llama · COMPARE
 ─────────────────────────────────────
 ● protein folding  71     ● enzyme kinetics  44     +

                              ╭───────────────╮
                              │               │
   L25 ─                      │   the model   │                        GEMMA 2 2B
   L20 ─                      │   lives here  │
   L15 ─                      │  (nothing but │                             71
   L10 ─                      │   black       │                        COVERAGE
   L5  ─                      │   around it)  │
   L0  ─                      ╰───────────────╯                143 features · 18/26 layers · 9 ms

                                                               ▁▂▃▅▇▇▅▃▂▁▁▂▃▅▇▇▅▃▂▁▂▃▅▇
                                                               L0                     L25
```

- Search input: no box. A 1px `STRUCTURE` underline that becomes `BLUE` on focus. Placeholder in `MUTED`.
- Toggles: plain lowercase words separated by `·`. Active one is `TEXT` and slightly larger; inactive is `MUTED`. No pills, no switches.
- Score: 56px `TEXT`, with `COVERAGE` beneath it in 11px `MUTED` uppercase.
- Per-layer bars: bare 2px-wide vertical bars in the concept color, no axis, no container, just `L0` and `L{n-1}` beneath the ends.
- The layer slider on the left is the tick column itself — the `L0…L25` labels *are* the control. Drag through them.
- Detail drawer: slides in from the right as text on black with a single 1px `STRUCTURE` left edge. Feature description, all explanations, activation value when relevant, top-activating snippets with the trigger token in `YELLOW`, and a link to Neuronpedia in `MUTED`.

---

## 7. Empty and loading states

- **Nothing searched yet:** stack rotates slowly, scaffold only. One line of centered `MUTED` text below the stack: *type a concept from your field*. Nothing else on screen.
- **Loading:** a 1px `BLUE` line grows across the top of the viewport. Previous results stay lit at 40%. Never blank the scene.
- **Zero results:** the stack stays scaffold-only; one line in `MUTED` under the input: *no exact matches — try fewer words, or deep mode*.
- **Error:** same treatment, `RED` text, one line, no dialog.

---

## 8. What would break this

Reject each of these if the temptation appears:
- Any container with a visible background or border (the layout is text on void)
- A second font, or a monospace font for anything but numbers
- Colors outside §1
- Bloom or postprocessing before the core loop hits 55 fps without it
- Icons — words are cheaper and clearer at this scale
- A legend explaining the colors: labels sit next to the things they label
- Any object that is on screen while meaning nothing
