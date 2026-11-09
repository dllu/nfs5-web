# Native Verok aspect correction and camera field of view

The previous turn made concrete progress (`2cbf8cc`, native quality hooks and
viewport defaults, committed and pushed). Continued the user's visual-fidelity
priority before performance optimization. HUD inspection uncovered missing
projection hooks; these affect 3D cameras and effects and are separate from the
fixed-pixel HUD layout.

Read-only inspection of the unchanged supplied `nfs5.dll` establishes:

- Native video-mode wrapper `10003B90` updates dimensions and calls `10003840`
  after a successful mode change. The latter writes virtual height/width at
  `10006130`/`10006134` and horizontal half-FOV at `10006080`.
- At aspect ratios up to the native float threshold 1.3333333730697632, virtual
  width remains 640, virtual height is 640/aspect, and half-FOV is 37.5 degrees.
  Wider modes use virtual height 480, virtual width 480*aspect, and half-FOV
  atan2(3*aspect, 4/tan(37.5*0.017453292))/0.017453292. Native float stores and
  the exact DLL constants are preserved.
- Patch routine `10003C90` redirects 23 original instruction sites: projected
  effect and camera-size operands, the two reciprocal-multiply to divide
  changes, default/preset camera FOVs, camera zoom comparisons and frontend
  camera initializers. These are not a global replacement of 640/480 constants.
  The HUD's normalized layout functions, such as `0041EFF0`, remain separate.

`src/web_projection.h` implements the native mode calculation. The Thrash bridge
updates it only after successful mode creation/resize. Initialization restores
the 640x480 basis. The generator applies all 23 instruction hooks, including
copies of recovered shared tails, and validates their presence. Build metadata
requires the new projection hooks for the pinned executable. Native Windows
window placement stays with the browser's existing canvas/window behavior.

Validation passes:

- `tests/projection.mjs`: 260 output-float comparisons against original DLL code
  running in Unicorn, across portrait, square, 4:3, widescreen, ultrawide,
  threshold-adjacent, maximum and deterministic random dimensions. Its MSVCRT
  register-argument intrinsics use independent x87 FPTAN/FPATAN stubs, with
  explicit x87 control word 0x37F. All three stored float outputs match exactly.
- Another 168 comparisons execute the original camera-zoom function `00462B80`
  with the actual native DLL operand patches/trampoline, two players,
  transition states and zoom fractions. Camera-record/stack bytes and the
  non-EAX registers match. Volatile EAX carries x87 exception-status bits not
  fully modeled by the port and is deliberately outside that assertion.
- `npm test`: all new checks and all existing game, service, storage, input,
  Thrash and transport checks pass, including the earlier 260 native car/texture
  comparisons and 201 original-executable comparisons.
- `npm run test:renderer`: 143 backend checks, 187 native-driver checks and 433
  ABI calls pass. New cases verify actual native mode changes: 4:3 defaults,
  16:9 virtual basis and expanded FOV, rejected-mode preservation, and restoration
  to menu projection. No WebGPU validation errors.
- `npm run test:browser`: original intro/audio, maximum-quality/default viewport
  properties, menu-gradient pixels, input, persistence and Stop/restart pass.
- A fresh Chrome instance loads the saved maximum-quality `visuals` player and
  a Cote d'Azur quick race at 6144x3162x32. The live projection is
  [932.675537109375, 480, 48.194671630859375]; the original current/base/target
  camera fields agree on that half-FOV. Texture/car tiers remain 4/4. The scene
  renders, keyboard acceleration works (roughly 40 km/h in the captured frame),
  and Pause works without runtime or WebGPU errors. No concurrent guest-call
  injection was used for these observations.

Evidence: `build/projection-differential.json`, `projection-game-audit.json`,
`projection-race-current.png`, `projection-driving-paused.png`,
`projection-driving-gauges.png`, and the unit/browser/renderer projection logs
in `.cache/`. Wasm: 87,941,584 bytes, SHA-256
`2111472961c23903c240be8f6f89f25e88e505bcafa5d2aadd6e982cb56b3656`.
An incremental rebuild after a comment edit produced the identical module.

HUD/pause/loading panels still use fixed native pixel sizes at 6K; this change
corrects projection, not those layouts. The HUD layout globals and functions
match the preserved executable: width `60C900`, height `60C81C`, and normalized
layout work starting at `41EFF0`. These are useful next audit points; upstream's
HUD arrangement code is a separate customization, not a native scaling fix.
Nighttime projected headlights, broader scene comparisons, full campaign
progression, and the performance target remain incomplete. No runtime
performance optimization was attempted.
