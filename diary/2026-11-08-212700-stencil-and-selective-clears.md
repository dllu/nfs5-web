# Stencil rendering, selective clears and independent depth state

The previous goal turn made concrete progress (`e88798d`, native custom blend
factors and alpha-test modes, committed and pushed). This turn continues the
user's requested visual-fidelity work before performance optimization.

The original capability setup already accepted stencil state 47, but the bridge
retained its controls without implementing stencil. The WebGPU target had only
depth. Disassembly of the unchanged supplied `opengl3z.dll` establishes:

- State 47 enables/disables stencil (`10006428`); state 48 selects one of eight
  comparisons (`10006484`). The native function always passes reference 2 and
  read mask 255 to `glStencilFunc`. States 49–51 retain values but do not change
  that fixed reference/mask behavior.
- States 52/53/54 select stencil-fail, depth-fail and pass operations at
  `100064E2`/`10006542`/`100065A2`: keep, zero, replace, increment/decrement with
  clamp, invert, increment/decrement with wrap. Out-of-range values fail without
  replacing retained state.
- Native clear at `10008650` selects color, depth and stencil independently.
  Depth clear requires depth-test enablement and observes the depth-write mask;
  stencil clear requires stencil enablement. Scissor applies. The native clear
  stencil value is zero. The old bridge cleared color and depth unconditionally.
- Native window selection (`10008732`) accepts 0/1 for front, 2 for back and 3
  for auxiliary. With no auxiliary buffers, 3 still selects back for drawing,
  but disables color clearing. This distinction is preserved: window 3 does not
  invent a color-write mask. A ZERO/ONE blend can preserve color during mask draws.
- Native state 4 accepts only depth disabled/enabled, not mode 2. It does not
  overwrite the independent depth-write state. The browser previously accepted
  mode 2 and changed both controls together. Disabling depth testing also disables
  actual depth writes, even when the retained write mask is enabled.

The bridge now transports stencil controls and independent clear aspects in
protocol v6. Its 40-word state appends stencil enable/compare/operations,
reference/read/write masks and a color-write flag for backend operations. Clear
packets carry selected aspects and a clip rectangle. Existing v1–v5 packets
remain accepted, including their older clear layout and alpha defaults.

The backend prefers optional `depth32float-stencil8`, with core
`depth24plus-stencil8` fallback. Render passes preserve both aspects across
submissions. Pipelines implement the same operations on front and back faces;
each draw binds its own stencil reference. Full clears use independent render-pass
load operations. Clipped clears write only selected aspects through a scissored
triangle and bypass game texture, alpha, depth/stencil comparison and blend state.
Eight-bit conversion is consistent for full and clipped stencil clears.
The implementation follows the [WebGPU depth/stencil specification](https://www.w3.org/TR/webgpu/#dictdef-gpudepthstencilstate)
and [render-pass attachment specification](https://www.w3.org/TR/webgpu/#dictdef-gpurenderpassdepthstencilattachment).

Validation passes:

- `npm test`: 228 Thrash loader/ABI calls and 84 graphics-transport checks,
  alongside all existing execution/service checks. New cases cover native
  window aliases, rejected depth/stencil enums, queued stencil snapshots, and
  clipped clear packets with independent color/depth/stencil selections.
- `npm run test:renderer`: 143 backend pixel/batching checks, 177 native-driver
  checks and 432 ABI calls. Coverage includes all eight comparisons, all eight
  operations for each outcome, clamp/wrap boundaries, read/write masks, disabled
  stencil, alpha discard on every stencil outcome, queued reference changes, full/clipped aspect clears,
  eight-bit clear conversion, independent depth testing/writing and resize reset.
  Native entry points verify fixed ref/masks, retained-only states 49–51,
  stencil-fail/depth-fail updates, auxiliary fallback, selective clears and depth
  write-mask preservation across test toggles. A dedicated Worker renders a mask
  using the core depth/stencil format; the main checks use 32-bit depth/stencil
  on the GB10. No WebGPU validation errors occur.
- `npm run test:browser`: original startup, intro/audio, input, storage,
  viewport scaling and Stop/restart pass. Menu gradient samples are unchanged.

A fresh maximum-visible-quality `webtest` instance loads Normandie at
6144×3456×32. The saved graphics values remain at the previously selected maxima.
Holding Up reaches roughly 60 km/h in second gear and Escape opens Pause. A
temporary observer records 55,326 depth-only clears and 25,618 color/depth clears
across the observed frontend/race sequence, proving the real game uses selective
clearing. It sees no stencil-enabled draws in this daylight sequence. Stencil
operation correctness is established by the native/pixel tests, not a claim that
a particular game shadow or headlight effect is now visually verified. The
observer was removed afterward and the healthy race is left paused.

Ignored evidence: `build/stencil-game-audit.json`,
`build/stencil-{main-menu,race-6k,race-driving,race-paused}.png`,
`build/stencil-driving-gauges.png`, `build/webgpu-renderer.json`, and
`.cache/{build,unit,renderer,browser}-stencil.log`. Release Wasm is 87,937,688
bytes, SHA-256
`2582aaeafb2485f29072ffad64597c203cf889d96cef7c1caca7bd2a11a3e1a7`.

Full visual parity, projected-headlight/night verification, texture-stage paths,
new-player maximum-quality defaults, race HUD/pause scaling and campaign
progression remain incomplete. The earlier menu-return memory fault did not
recur and remains unexplained. No Wine files changed and no FPS optimization or
performance claim was made.
