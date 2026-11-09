# Restore native mip chains and texture sampling controls

The previous goal turn made concrete progress (`1252159`: diffuse/specular
shading, tests, README and diary were committed and pushed). This turn continues
the user's requested visual audit before further performance work.

Disassembly of the supplied unchanged `opengl3z.dll` established the next
rendering mismatches. Native state 7 stores the spatial filter at `10005D9C`;
state 11 stores the mip filter at `10005D91`. Their combination is applied at
`10008AF1`: spatial point/linear, with no mip filtering, nearest mip selection,
or linear blending between mip levels. State 8 is a float LOD bias, applied
through `GL_TEXTURE_LOD_BIAS` at `10008AC0`. States 13, 65 and 66 select
clamp/repeat/mirrored repeat for both axes, U and V respectively. States 47/48
are stencil controls, not texture address controls.

The browser bridge previously used 7/47/48 to change a shared wrap bit and
11/13/65/66 to overwrite one spatial-filter bit. Consequently a native address
change could disable bilinear filtering, and mip filtering had no implementation.
It now maps the native controls independently and uses their native defaults:
linear spatial filtering, nearest mip filtering and clamp addressing.

Native texture allocation takes the additional mip count from argument 5's
low word (`10006E65`..`10006E6B`). Allocation at `100071FE` and update at
`10007980` iterate the supplied chain from the largest level to the smallest.
The browser previously ignored that argument and converted/uploaded only the
base image. It now retains the level count, converts the whole supplied chain,
and sends its RGBA bytes through the existing chunked upload queue. WebGPU
allocates and uploads each supplied level; it does not synthesize replacement
levels. The level layout also handles rectangular textures down to a one-texel
axis. Invalid counts beyond the full chain are rejected.

Transport v4 appends sampler controls to the state and a level count to texture
creation. Existing v1/v2/v3 packets still work. The renderer uses separate U/V
sampler modes and mip filters, clamps LOD to zero when mip filtering is disabled,
and applies bias through `textureSampleBias`. The relevant browser API behavior
is specified by [WebGPU samplers](https://www.w3.org/TR/webgpu/#dictdef-gpusamplerdescriptor)
and [WGSL textureSampleBias](https://www.w3.org/TR/WGSL/#texturesamplebias).
The supplied native driver determines the state numbers and game data layout.

Validation passes:

- `npm test`, including 128 Thrash loader/ABI calls and 47 transport checks.
  New coverage verifies address-mode validation/defaults, invalid mip counts
  and queued mip/U/V/bias state alongside shading and vertex bytes.
- `npm run test:renderer`: 53 backend pixel/batching checks, 90 native-driver
  checks and 158 native ABI calls. Deliberately different colors in each mip
  verify actual minification, nearest/trilinear selection, positive/negative
  bias, base-level magnification, rectangular chains and update ordering.
  Native RGB565 chains exercise original driver entry points. Five repeated
  5.3 MiB ARGB source-chain uploads wrap the queue under backpressure; sampling
  the last 1×1 mip proves the tail survived. Independent U/V clamp/repeat/mirror
  and the separation of spatial, address and stencil states are checked.
  Bilinear midpoint comparisons allow one byte of GPU rounding variation.
  Legacy v1–v3 consumers wake after idle and render indexed/unindexed geometry
  and old-format texture packets.
- `npm run test:browser`: original startup, intro/audio, keyboard, storage,
  viewport/input scaling and Stop/restart all pass. The original menu-gradient
  pixels are unchanged, and WebGPU reports no validation errors.

A fresh maximum-quality `webtest` instance entered Evolution's Normandie race
at 6144×3456×32. A temporary JS observer recorded 337 textures with 4–8 supplied
mip levels (13/16/102/174/32 textures at levels 4/5/6/7/8), trilinear sampling,
LOD biases −3.25 and −1, and mixed U/V address modes. Thus the original game
actually uses the implemented path. The observer counted over 1.45 million
draws using those textures and reported no WebGPU errors. Holding Up moved the
camera and reached roughly 60 km/h in second gear; Escape opened Pause. The
observer was removed afterward, leaving the healthy race paused. No guest state
or saved settings were changed for this check.

Ignored evidence: `build/mipmaps-game-audit.json` includes the saved graphics
values and observed samplers; `build/mipmaps-{race-ready,race-driving,race-paused}.png`,
`build/mipmaps-driving-gauges.png`, `build/webgpu-renderer.json`, and
`.cache/{build,unit,renderer,browser}-mipmaps.log`. Release Wasm is 87,937,491
bytes, SHA-256
`c784c20a8f8bd4bc9944b54984228788aca0d9d84de0747b3c8b0b4110006a13`.

This improves texture fidelity but does not establish complete native visual
parity. Multitexture, projected headlights, new-player quality defaults and
small fixed-pixel race HUD/pause controls remain open. The earlier menu-return
memory fault remains unexplained and did not recur here. No Wine installation
files changed, and no performance optimization or FPS claim was made.
