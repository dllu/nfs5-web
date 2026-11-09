# Native custom blending and alpha-test behavior

The previous goal turn made concrete progress: native mip-chain and sampler
support was committed and pushed as `69a4cc3`. The visual audit continues before
performance work.

Reading the supplied unchanged `opengl3z.dll` exposed two compositing mismatches:

- Native states 404/405 (`1000693F`/`100069ED`) select ten independent source and
  destination blend factors. The browser rejected both states. Original game
  helper `00540550` can request source DST_COLOR and destination SRC_COLOR when
  passed −1, producing doubled modulation. Its entry had executed in the live
  game, so this is an original renderer path, not an invented host extension.
- Native state 10 (`10005FB7`) controls both blending and alpha comparison.
  For ABI 107, modes 0/1 disable blending and use ALWAYS; 2/3 enable blending
  and alpha GREATER than the reference. Older ABIs also enable mode 1. State
  31 selects the client ABI. Native state 36 (`10006031`) only changes the full
  unsigned reference divided by 255. The browser instead used state 36 as an
  enable switch, masked its value to one byte, accepted only modes 0/2, and
  compared alpha with GEQUAL. Thus zero-alpha fragments could write depth when
  the reference was zero, and boundary-alpha fragments could pass incorrectly.

The bridge now implements both custom factors with the native enum mapping:
ONE, ZERO, SRC_ALPHA, ONE_MINUS_SRC_ALPHA, DST_ALPHA, ONE_MINUS_DST_ALPHA,
SRC_COLOR, DST_COLOR, ONE_MINUS_SRC_COLOR, ONE_MINUS_DST_COLOR. Invalid values
preserve the previous state. Presets retain their native 404/405 values; custom
factors mark preset states 56 and 104 as the native custom sentinel 4.
The [WebGPU blend specification](https://www.w3.org/TR/webgpu/#enumdef-gpublendfactor)
defines the corresponding RGBA operations used by the backend.

Alpha reference updates no longer enable or disable comparison. Blend modes
select the native comparison and honor the client ABI. WGSL implements all
eight comparison functions after texture/specular composition and before fog.
Transport v5 appends the comparison function; v1–v4 packets retain the previous
GEQUAL default. Uniform-buffer size is unchanged.

Validation passes:

- `npm test`: 192 Thrash loader/ABI calls and 49 graphics-transport checks,
  plus all existing execution/service checks. New checks cover preset/custom
  state coupling, invalid factor preservation, ABI-dependent blend modes and
  queued alpha-reference/comparison state alongside shading and sampler data.
- `npm run test:renderer`: 69 backend checks, 150 native-driver checks and 316
  native ABI calls. All eight alpha functions are checked below and exactly at
  the threshold. Every native source/destination blend factor is checked with
  known colors. Executing original `00540550(404, -1)` produces the expected
  doubled-modulate pixels. Native modes 0–3, reference 0/127/128/255/256,
  older-ABI mode 1 and zero-alpha depth rejection are verified. Legacy v1–v4
  draw/texture packets preserve their alpha boundary behavior and wake after idle.
- `npm run test:browser`: original startup, intro/audio, input, storage,
  viewport scaling and Stop/restart pass. Original menu-gradient samples remain
  unchanged, and there are no WebGPU validation errors.

A fresh `webtest` instance loads the maximum-quality Normandie race at
6144×3456×32 without WebGPU errors. Holding Up reaches roughly 60 km/h in second
gear; Escape opens Pause. A temporary JS observer recorded native GREATER with
references 0/1/10 and ALWAYS while comparison was disabled. It observed normal
alpha and additive blend pairs in this sequence; it did not observe a custom
pair. The original helper's entry was seen, but that alone does not prove its
−1 branch ran during this race. The synthetic original-code pixel check proves
that branch separately. The observer was removed, leaving the race paused.

The projected-headlight audit remains open. Original RTTI identifies
`Headlights::LayerUVLight` at type descriptor `005CEC98`, vtable `005B3DAC`, with
render entry `00453CA0`; `LayerVertexLight` has render entry `00453110`.
Neither entry executed in this daylight scene. Trying L did not make either
entry execute; the correct binding/night scenario still needs identification.
The embedded native GLSL samples one texture, but this alone does not establish
the game's complete texture-stage/fallback behavior. Native stencil states
47/48/52–54 also need implementation/auditing: the bridge currently retains
them, while its depth target has no stencil attachment. No unsupported feature
was enabled merely to make a capability probe pass in this change.

Ignored evidence: `build/compositing-game-audit.json`,
`build/compositing-{main-stable,race-ready,race-driving,race-paused}.png`,
`build/compositing-driving-gauges.png`, `build/webgpu-renderer.json`, and
`.cache/{build,unit,renderer,browser}-native-compositing.log`. Release Wasm is
87,937,839 bytes, SHA-256
`b6daff1f47547f2091c34e1a4d5bf3fe37703c766ac0d979bd610c055fb62aef`.

Full visual parity, new-player maximum-quality defaults, race HUD/pause scaling,
campaign progression and performance targets remain incomplete. The existing
menu-return memory fault remains unexplained and did not recur in this check.
No Wine files changed and no FPS optimization was attempted.
