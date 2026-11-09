# Native Verok quality hooks and viewport defaults

Continues the requested visual-fidelity work before performance optimization.
The previous concrete progress was `4493515` (stencil and selective clears).

Read-only inspection of the supplied `nfs5.dll` (SHA-256
`f24b5c82404f403645e5bc3e52d47e4dd6d19bd92613c243ac31bea285fce758`)
revealed two missing native patch features:

- The original executable's `0044DFB0` overwrites the saved texture preference
  with CPU/VRAM autodetection. The prior test profile saved TextureDetail=4,
  but its actual race texture tier was 2. Verok redirects this to `10001030`,
  which preserves `657D88` in `619770`, with a tier-2 cap in 16-bit modes.
- Verok expands car detail from three to five choices (`004E5817`), preserves
  the selected tier in `6197C4` (`0044EF8B`/`0044F110`), changes loader budgets
  (`0043A083`, `0043A08A`, `0043A3B6`), and replaces the car-layer selector
  (`00444E00` -> DLL `100012C0`/`10001090`). The original highest setting of 2
  is consequently Medium in the patched five-level menu; Very High is 4.

`tools/verok_quality.py` now lifts the supplied DLL's car routine and extracts
its six read-only LOD/mesh tables into ignored generated output. Validated
instruction hooks apply to all recovered copies of shared game tails. The
texture selection and original thiscall wrapper preserve native calling/stack
conventions. Preparation checks the exact DLL hash, and builds require these
hooks for the pinned executable. No original binary is rewritten.

New graphics properties use the original setters to initialize Very High
textures/car detail/world/distance, High car lighting/sky, projected headlights,
lens flare, and a 32-bit browser-viewport mode. Existing saves subsequently load
their own preferences. Editing the staged XXDefXX template proved ineffective:
the original game regenerates it from the graphics constructor. That approach
was removed; staging again copies all original payloads unchanged.

The Thrash mode list appends viewport mode 29 and a disabled final sentinel,
without moving any fixed modes or saved resolution choices. The original
frontend iterates indices [0, maximum), while the driver searches [1, maximum];
the sentinel makes the viewport mode visible to both. The frontend property
index is 26. Browser dimensions include device pixel ratio, with a 640x480
minimum; a separate snapshot keeps game display changes from replacing the
browser's requested dimensions. Canvas display and pointer scaling continue to
fill resized browser windows. The internal default resolution is sampled at
launch. The manual harness waits for Chrome's maximization before launching;
a premature automatic launch sampled temporary 2001x2099 window bounds.

Validation passes:

- A clean regeneration/build produces 87,941,249-byte Wasm, SHA-256
  `875f50cbda892d1ebdb2593c9cf63bc03543e7f699c39edf8718e0c594280c54`.
- `npm test`, including 260 new independent native-DLL/Unicorn versus Wasm
  comparisons: five texture tiers at 16/24/32-bit color and five car tiers across
  seven distance levels, player/AI/frontend, cockpit/effects, special and damage
  paths. Original mesh Render callbacks record the selected meshes and flags.
  All existing execution, service, Thrash and transport checks pass.
- `npm run test:browser`: the original frontend's nine default properties and
  selected 1440x1000x32 viewport mode, actual gradient pixels, intro/audio,
  storage, input, viewport stretching and Stop/restart pass. Regression checks
  caught and prevented both the regenerated-template override and omitted last
  mode. Reports: `build/original-menu-gradients.json` and browser logs in cache.
- `npm run test:renderer`: 143 backend checks, 177 native-driver checks and 432
  ABI calls, with no WebGPU validation errors.
- Created `visuals` through the original UI in fresh Chrome storage. The menu
  shows 6144x3162x32 and maximum detail choices without manual graphics edits.
  `0visuals.sav` is byte-identical across a full Chrome restart: 147,729 bytes,
  SHA-256 `ed59400d0de691633fb1d0c82139accbaaf115dad83efd8f3193e7d2f70cd737`.
- After that restart, a Cote d'Azur quick race with the 356 A Convertible
  renders at 6144x3162x32. Read-only original race-state inspection confirms
  requested/active texture tiers 4/4, requested/active car tiers 4/4, world=3,
  distance=3, headlights=1, and both quality hooks executed. Keyboard acceleration
  reaches roughly 80 km/h; Pause works. No runtime or GPU validation errors.
  Evidence: `build/quality-viewport-audit.json`, `quality-v4-maximum-settings.png`,
  `quality-viewport-driving-paused.png`, `quality-viewport-gauges.png`, and
  `quality-v4-saves-{before,after}.json`.

Hidden Reflections=0 means Low, not Off. DetailedShadows, ShadowMapping and
TexturedDamage use Off/On enums; their old values are retained. Their property
IDs map to 657D98/94/90/8C, but no active rendering reads were identified in the
recovered code. No unsupported visual behavior is inferred by forcing them on.
Nighttime projected headlights and broader original-versus-browser scene
comparisons remain outstanding. HUD/pause/loading elements still use small
fixed pixel sizes at 6K. The performance target and full campaign remain unmet;
no further performance optimization was attempted.
