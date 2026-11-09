# Match the supplied renderer's diffuse and specular shading

Visual fidelity remains the priority before further performance work. Reading
the embedded GLSL and state handlers in the supplied, unchanged `opengl3z.dll`
identified three more differences in the browser bridge:

- Native state 6 at `10006716` selects flat diffuse (0), Gouraud diffuse (1), or
  Gouraud diffuse plus specular (2). Mode setup at `100032BC` selects 1. The
  browser previously ignored this state and discarded specular RGB entirely.
- The native fragment shader always multiplies texture RGBA by diffuse RGBA,
  then adds the full specular RGBA in mode 2, before alpha comparison and fog.
  Native state 41 is retained without changing that behavior. The browser
  incorrectly used it to choose texture alpha or even disable texturing.
- OpenGL's default flat color comes from the last primitive vertex, while
  WebGPU flat interpolation uses the first. Native quad draws at `10009330`
  split into `(a,b,c), (c,d,a)`; the browser's second triangle ended in `d`.
  Sprites intentionally use a different split and keep their second endpoint's
  flat color in both triangles.

The bridge now validates and transports all three shading modes and defaults
to Gouraud with RGBA texture modulation. The WGSL shader selects flat/smooth
diffuse and adds screen-linear specular after texturing. Flat triangle indices
rotate cyclically to preserve winding; line pairs reverse and points stay
unchanged. Quads and quad meshes use the native split. Sprite topology is
unchanged. The graphics transport is v3 with an appended shading field; the
consumer still accepts v1/v2 draw packets with the original Gouraud default.

The interpolation conventions are documented by the
[WGSL interpolation specification](https://www.w3.org/TR/WGSL/#interpolation)
and [OpenGL provoking-vertex extension](https://registry.khronos.org/OpenGL/extensions/ARB/ARB_provoking_vertex.txt).
The supplied native shader and disassembly determine the game-specific choices.
Ignored copies of the extracted shaders are in
`build/verok-opengl3-{vertex,fragment}.glsl`.

Validation passes:

- `npm test`, including 104 Thrash loader/ABI calls and 42 transport checks.
  These cover shading defaults, valid/invalid modes, retained state and queued
  v3 state/vertex snapshots, in addition to the existing original-code checks.
- `npm run test:renderer`: 41 backend pixel/batching checks, 65 native-driver
  checks and 102 native ABI calls. New checks cover flat indexed/unindexed
  triangles, culling, lines/points, native quad/quad-mesh/sprite colors,
  unequal-RHW diffuse/specular interpolation, specular saturation, texture
  modulation, alpha-test/fog order and changes between queued shading modes.
  Both legacy protocol versions render indexed and unindexed draws after idle.
  Native readrect returns opaque display pixels; fragment alpha is verified
  independently by reading the actual render target.
- `npm run test:browser`: original startup, keyboard, audio, storage,
  viewport/input scaling and Stop/restart pass. The original Create Player
  gradient remains `(215,104,104,193)`, `(181,0,0,246)`, `(88,0,0,192)` at the
  highlight, middle and lower edge. WebGPU reports no errors.
- A fresh Chrome instance loads the saved `webtest` profile and Evolution's
  Normandie race at 6144×3456×32 with no WebGPU errors. The saved quality values
  remain TextureDetail 4, CarDetail/CarChrome 2, SpecialFX/ViewDistance 3,
  Headlights/LensFlare 1 and SkyRendering 2, with gamma 100. A temporary JS draw
  observer saw actual game modes 0 and 1 during this sequence; it did not see
  mode 2. Synthetic native-driver checks establish mode-2 behavior, not an
  observed specular pass in this particular race. No guest state or save bytes
  were modified for this check.

Evidence: `build/webgpu-renderer.json`, `build/native-shading-main-loaded.png`,
`build/native-shading-race-6k.png`, `build/native-shading-race-paused.png`,
`.cache/{unit,renderer,browser}-native-shading.log`. The release Wasm is
87,936,628 bytes, SHA-256
`4003c64e4f1597dbacefe2b1e89e42cefe214257d36a931753be318d227cb8a9`.

This does not establish complete visual parity. Mipmaps, multitexture,
projected-headlight rendering, highest-quality defaults for new players and
the small fixed-pixel race HUD/pause controls still require work. The existing
menu-return memory fault did not recur in this check and remains unexplained.
No Wine installation files changed, and no FPS optimization was attempted.
