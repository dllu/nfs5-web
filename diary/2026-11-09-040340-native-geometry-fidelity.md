# Native geometry and texture projection

The visual audit now covers the supplied Verok OpenGL3 vertex shader's geometry
and texture projection, in addition to fog. The WebGPU shader uses the same
screen-space geometry: clip-space W is one, depth above one resets to zero,
and negative depth reaches the near-plane clipper. Reciprocal W (RHW) affects
projected texture coordinates and fog without changing geometry clipping.

Previously the shader clamped depth to [0,1] and used 1/RHW for clip-space W,
with a fallback for small RHW. This produced different coverage, depth and UVs
for near-plane crossings, above-range depth, and zero/negative/small RHW.
The corrected path linearly interpolates (U×RHW, V×RHW, RHW), then divides
at the fragment, matching the embedded GLSL. Untextured draws bypass texture
sampling and UV division. Two internal uniform bits independently select
texturing and diffuse-alpha modulation, preserving the backend's alpha modes.

`tests/native-shader.mjs` extends and replaces the fog-only shader comparison.
It extracts both GLSL programs from the SHA-pinned original DLL, changing only
desktop version/precision declarations for WebGL2. The first baseline run fails
12 of 15 geometry comparisons; the largest channel error is 215/255. After
the fix, 17 cases pass, including two additional untextured zero-RHW/unused-UV
checks. Depth and color cases match exactly; filtered-texture cases differ
by at most one color level. All 18 fog comparisons still match exactly.
Comparisons cover a 56×56 interior region and all four color channels.

Persistent Chrome profiles initially reused a cached shader during two
intermediate runs. Browser checks now enable the CDP Network domain and disable
its cache before loading, so checks use the current build. The final checks
use this setup; the initial baseline used a fresh profile.

Validation passes:

- `npm run build`. No guest code changes; Wasm remains 87,950,679 bytes,
  SHA-256 `592f2b13ccac61c45707d93ec6d91593648dc96a650fe212a0069534dd6ca26e`.
- `npm run test:renderer`: 143 backend checks, 285 native-driver checks,
  446 ABI calls, 18 native GLSL fog cases and 17 geometry cases pass without
  GPU errors. This includes the existing 4K, mipmap, blend, depth/stencil,
  transport and UI checks.
- `npm run test:browser`: startup, intro/audio, storage, input, maximum
  defaults, portraits, menu gradients, viewport scaling and Stop/restart pass.
  Original gradient samples remain `(215,104,104,193)`, `(181,0,0,246)` and
  `(88,0,0,192)`.
- Manual Chrome at 6144×3162×32 renders the player chooser, frontend car and
  Côte d'Azur race with active texture/car tiers both 4 and no GPU errors.
  A read-only host sample of 500,000 submitted vertices finds 74,151 Z values
  above one and 16,665 negative Z/RHW values (Z range approximately -77.77 to
  407.94), confirming that these shader paths occur in the live game.
  Acceleration and pause use normal keyboard input. The observer is removed
  afterward; no guest routines are invoked externally during play.

Ignored evidence includes `build/native-geometry-{baseline,renderer,live}.json`,
`build/native-fog-renderer.json`, `build/geometry-live-*.png`, and the geometry
build, baseline, renderer and browser logs in `.cache/`. README describes the
expanded comparison coverage. Whole-scene equivalence, weather, visible flare
artwork, full gameplay and the 4K/120 Hz target remain open; the implementation
goal is incomplete.
