# Scaled loading artwork and interface strokes

Interface lines and points expand into triangles at enlarged UI scales. Their
thickness follows the logical canvas, including the damage display's gradient.
The minimap camera already supplies physical coordinates, so its drawing scope
enlarges stroke widths while preserving projected positions. Scene lines retain
their native one-pixel rasterization. Flat/Gouraud colors, source vertices,
depth, RHW, UV and specular/fog attributes are preserved.

The race-loading function centers its original 640×480 bitmap in logical UI
coordinates. Explicit scopes cover its tiled draw and software-surface unlock.
The latter matters in the real game: it paints into a locked physical framebuffer
and uploads after the bitmap draw returns. Scaling that upload clips the unused
surface region at the viewport. The original source artwork is unchanged.
Generation validates 84 distinct UI instruction locations. Thread/run entry
resets both interface scope counters; the build requires the updated hook tag.

Validation on the final build:

- Full source regeneration passed; only the expected loading-function chunk
  changed from the preceding generated source.
- `npm test`, `npm run test:browser` and `npm run test:renderer` passed.
- Renderer checks: 143 backend checks, 261 native-driver checks, 442 ABI calls.
  New pixel checks cover horizontal/vertical/diagonal UI strokes, points,
  Gouraud and indexed flat colors, degenerate/nonfinite/invalid inputs,
  preserved attributes, and projected minimap endpoints. A native scene line
  still covers exactly one physical row at 4K.
- Browser checks include original menu-gradient pixels, maximum-quality
  defaults, viewport/input scaling, storage and Stop/restart.
- A fresh Chrome race ran at 6144×3162×32. Presentation readbacks captured the
  actual loading screen with its active flag set. Its nonblack artwork bounds
  scale from `(146,0,786,474)` to `(961,0,5176,3122)`, within two pixels of the
  independent UI scale calculation. The panel is centered and fills viewport
  height, including its original black bottom margin.
- Live driving, damage gradient, minimap strokes and the pause menu were
  visually checked. Texture/car tiers remain 4; all three camera half-FOV
  values remain 48.194671630859375 degrees. WebGPU validation reports no errors.

Local evidence: `build/scaled-loading-verified-*.png` and `.json`,
`build/scaled-ui-race-verified.png`, `build/scaled-ui-pause-verified.png`,
`build/scaled-ui-validation.json`; logs `.cache/*scaled-ui-final.log`.
Wasm: 87,945,705 bytes, SHA-256
`cc005069a0c9830d0d640f68bf6fb6ab954555f3167e0abbb14a91f51bf13f30`.

Broader scene/sky/effect fidelity, including nighttime projected headlights,
still needs native comparison. Visual correctness remains ahead of performance
tuning; this does not establish the 4K/120 Hz target or a complete game.
