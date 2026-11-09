# Readable HUD and pause controls

The race renders at full resolution while its original 2D interface uses a
separate logical canvas. A 6144×3162 viewport uses 933×480 UI coordinates. The
original HUD anchoring, widget sizes, fonts and layout serialization continue
to operate in those units; existing physical-size records remain in the HUD
files. The height adjustment also handles tall logical viewports.

The explicit hooks cover 79 original instruction locations, including recovered
copies. Interface submission scopes scale vertex positions and clipping; they
leave scene and rear-view rendering in physical pixels. Verok's camera and
projection values remain independent of UI dimensions.

UI mouse consumers receive a 20-byte copy of the original input record with
logical X/Y. The original polling/clamping record, Windows messages and
DirectInput data retain physical coordinates. The separate button-event getter
converts its output coordinates and retains its one-shot behavior. This covers
the polling path that bypasses startup GetCursorPos. Scope state resets on
worker/run entry and runtime initialization.

Validation:

- Full source regeneration passed and reproduced every generated file exactly.
- `npm test` passed, including 56 logical-layout/original-HUD-anchor checks,
  existing Verok quality/projection comparisons and service/lifecycle tests.
- `npm run test:renderer` passed: 143 backend checks, 211 native-driver checks
  and 438 ABI calls. The added checks execute the original widget hit test and
  button-event getter at 4K, verify physical input remains unchanged, preserve
  wheel/buttons in UI snapshots, and exercise mode restoration.
- `npm run test:browser` passed, including original menu gradient pixels,
  maximum-quality defaults, viewport/input scaling, storage and Stop/restart.
- A fresh Chrome run entered Côte d'Azur at 6144×3162×32. Text, gauges, rear-view
  placement and pause controls scale visibly. Continue highlights under the
  physical browser cursor and resumes the race. Holding Up reached about
  60 km/h in second gear; a subsequent pause remained healthy. Texture/car
  tiers are both 4; all three camera half-FOV values remain 48.1946716 degrees.
  WebGPU validation reported no errors. An explicit 6K test display avoids
  transient Chrome startup window bounds; automatic viewport selection is
  covered separately by the browser test.

Local evidence: `build/ui-driving.png`, `ui-resumed.png`, `ui-pause-hover.png`,
`ui-pause-final.png`, `ui-viewport-audit.json`; logs in `.cache/*ui-final.log`.
The Wasm is 87,943,512 bytes, SHA-256
`5e5297fa9d437593476704ed1d180cc1b4eb76b36faf1069e345be95e5d82629`.

Visual work remains before performance tuning: the race-loading panel and
minimap stroke widths still use fixed physical pixels. Nighttime projected
headlights and broader scene/effect fidelity still need comparison. Menu
clicks can require retries. This is progress on the port, not a completed game.
