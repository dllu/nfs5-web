# Native fog fidelity

Visual fidelity remains the priority. The WebGPU fog path now follows the
supplied Verok OpenGL3 driver's state handlers and embedded vertex shader.
The original installation remains unchanged.

The audit found several differences with visible consequences:

- Fog color alpha controls maximum strength; the bridge discarded it.
- Native fog is computed at vertices and interpolated in screen space. The
  WebGPU path computed exponential fog at fragments instead.
- States 22/23 supply unsigned integer start/end uniforms. They were cached
  without updating the renderer.
- States 20/21/105 share a native mode handler and per-state raw-value cache.
  The bridge misread two aliases as fog-table pointers and overwrote vertex
  specular values. Native modes 2/4/8 select linear/exp/exp2 fog; unsupported
  values produce no fog, and mode 1 restores the last selected raw mode.
- Native density accepts reciprocal integers 1–4095, otherwise float bits,
  including negative values. Initial fog uniforms are zero.

`tests/fog_oracle.py` executes the unmodified x86 DLL's exported state setter
in Unicorn, including its cache, dispatcher and x87 conversions. Only GL
uniform entry points are replaced by argument-recording stubs. The pinned
driver SHA-256 is
`5a57e6c244ea40ea90d69cf13bd3b79144ebca0a980f1d7cb87af48197581f6f`.
`tests/fog.mjs` compares 36 state changes against actual Wasm draw packets,
including aliases, repeated values, alpha, large unsigned ranges, density
bit patterns, unsupported modes and preservation of specular color.

`tests/fog-renderer.mjs` extracts the two GLSL programs directly from that DLL
and executes them in Chrome WebGL2. Only the version and precision declarations
change. Their fog pixels are compared with WebGPU over a 56×56 interior region,
all four channels, using unequal RHW, three fog modes, four alpha strengths,
reversed ranges, zero/negative density and zero RHW. The old shader fails the
first case (alpha zero): maximum channel error 152/255, with 6,061 components
differing by more than one. All 18 cases now match exactly, maximum error zero.
This isolated fog comparison does not establish whole-scene shader parity.
The native embedded shader uses one texture sampler and one UV pair.

Validation passes:

- `npm run build`: Wasm 87,950,679 bytes, SHA-256
  `592f2b13ccac61c45707d93ec6d91593648dc96a650fe212a0069534dd6ca26e`.
- `npm test`, including all 36 native fog state comparisons and nine native
  portrait conversions.
- `npm run test:renderer`: 143 backend checks, 285 native-driver checks,
  446 ABI calls, then 18 native GLSL fog pixel comparisons without GPU errors.
- `npm run test:browser`: startup/intro/audio, persistence, input, maximum
  defaults, portraits, menu gradients, viewport scaling and Stop/restart pass.
  Gradient samples remain `(215,104,104,193)`, `(181,0,0,246)` and
  `(88,0,0,192)`.
- Manual Chrome quick race on Schwarzwald renders at 6144×3162×32, with active
  texture and car tiers both 4. Read-only host draw observation records enabled
  exponential fog, changing fog colors and density near 0.00088, plus unfogged
  passes. The renderer reports no GPU errors. Observation is removed after the
  check; no guest routines are invoked externally during play.

Ignored evidence: `build/native-fog-states.json`,
`build/native-fog-renderer.json`, `build/fog-live-*.png`, and
`.cache/{test-fog,renderer-fog,browser-fog,fog-renderer-baseline}.log`.
README describes current fog support and keeps broader scene fidelity under
audit. Weather, visible flare artwork, full gameplay and the 4K/120 Hz target
remain unverified or unmet; the implementation goal is incomplete.
