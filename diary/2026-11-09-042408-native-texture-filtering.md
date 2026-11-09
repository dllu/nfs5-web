# Native texture-filter override

The bridge now honors the supplied OpenGL3 driver's `OGL_TEXFILTER=1`
setting. Native batch submission at `10008A60` selects bilinear spatial
filtering and trilinear mip filtering when mipmaps are enabled, independently
of the raw state 7/11 filter choices. The bridge previously ignored this
override and could select nearest mip levels instead. Mode 2 forces nearest
spatial/mip sampling; mode 0 keeps the game's choices. Disabled mipmaps and
textures without mip levels retain their native behavior.

The native option reader (`10009740`) first checks `[THRASH]` in the
DLL-adjacent `opengl3z.ini`, trying `OGL_` then `THRASH_` keys. It then tries
the same environment keys. The game's separate `thrash.ini` `[ENV]` loader
populates those environment variables; the supplied file sets `OGL_TEXFILTER=1`.
The native about/init entry points invoke guarded configuration initialization
at `10002440`. The bridge captures options at that point too, allowing changes
after DLL loading and before the first query. Raw filter state queries continue
to return the game's requested values; only textured draw submissions apply
the override. INI-selected values also populate the process environment.

A live check caught the missing preceding startup step: Verok's
`nfs5.dll:100022B0..10002879` copies the selected driver's `[ENV]` section before
CRT environment snapshots. That part of the startup patch was not ported.
The host now performs the same environment preparation at the tested executable's
CRT entry, `005A2D1A`, before original startup code runs. It selects the driver
from `nfs5.ini`, reads that driver's `thrash.ini`, and preserves the configured
environment for the later driver query. Synthetic framebuffer transfers retain
point sampling; the native geometry filter override does not apply to them.

The sampler audit also verifies the per-state cache shared by address aliases
13/65/66. Repeating the same raw both-axis state does not overwrite independently
selected U/V modes. The bridge now preserves this native behavior. An existing
GPU check assumed such a repeated value restored repeat mode; it now verifies
the retained mirror modes first, then explicitly changes the both-axis state
before testing stencil independence.

`tests/filter_oracle.py` executes the SHA-pinned, unmodified original x86
driver's state dispatcher and sampler setup in Unicorn. Only GL texture-parameter
entry points are replaced by argument-recording stubs; execution stops before
unrelated vertex-buffer uploads. Native force-initialization installs defaults
before the real exported setter handles test changes. `tests/filters.mjs`
compares the emitted GL parameters with Wasm draw packets for 187 cases across
11 configurations: overrides, missing/invalid options, file/environment prefix
precedence, initialization timing, UTF-16LE configuration, supplied mip levels,
LOD bias, address aliases and raw state queries.

Validation passes:

- `npm run build`: Wasm 87,956,366 bytes, SHA-256
  `58ef4a776de96dccdc8de93c437e3a065422ea1a472a44b5ae773a7deb92f086`.
- `npm test`, including all 187 native sampler comparisons, existing native
  quality/projection/fog/visibility/portrait comparisons and host/lifecycle checks.
- `npm run test:renderer`: 143 backend checks, 287 native-driver checks,
  450 ABI calls, 18 embedded-GLSL fog comparisons and 17 geometry comparisons
  pass without GPU errors, including existing trilinear mip pixel checks.
- `npm run test:browser`: original startup/intro/audio, saves, input, maximum
  quality defaults, portrait conversion, gradients, viewport scaling and
  Stop/restart pass. The menu check overlays an isolated driver-INI fixture,
  verifies the startup-copied environment through the snapshot API after the
  game has stopped, and checks filtering on actual native textured geometry.
  Framebuffer copies are counted separately. The original gradient samples
  remain `(215,104,104,193)`, `(181,0,0,246)` and `(88,0,0,192)`.
- Manual Chrome with the actual staged INIs renders the frontend and Côte
  d'Azur at 6144×3162×32 with texture/car tiers both 4 and no GPU errors.
  Native textured geometry uses bilinear sampling. The observed race uploads
  no mipmapped textures and keeps mip filtering disabled, so this run does
  not establish live trilinear use. Native texture allocation/capabilities and
  mipmap submission need comparison before claiming maximum scene quality.

The small INI reader supports files up to 64 KiB. Oversized environment values
do not reproduce the native helper's use of an undersized output buffer.
Other OpenGL driver options remain under audit. The original installation
is unchanged. Whole-scene equivalence, weather, visible flare artwork, full
gameplay and the 4K/120 Hz target remain open; the implementation goal is
incomplete.

Ignored evidence includes `build/native-filter-states.json`,
`build/native-filter-live.json`, `build/filter-live-*.png`,
`build/{opengl3,verok}-disasm.txt`, and the filter build/unit/renderer/browser logs in
`.cache/`. README documents the active filtering override and native comparison
coverage.
