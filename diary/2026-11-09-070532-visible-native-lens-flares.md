# Visible native lens flares

The preceding turn made concrete progress in `2a2d186`, comparing live rain
and snow artwork. This turn continues visual verification before performance
work and establishes visible lens-flare artwork in the native and browser games.

Both Normandie (`farmland`) runs use 1152×864×32, active texture/car tiers 4,
and the original direct-race configuration in isolated reference sessions.
Ordinary keyboard driving reaches the open farmland. Looking behind from the
cockpit initially puts the sun behind the car's roof, despite its presence in
the mirror. Cycling to a bumper camera removes that obstruction. HUD/mirror
display toggles and native steering were also used to obtain clear views.
No live guest memory was changed and no guest routine was invoked externally.

`build/browser-farmland-clear-sun.json` records initialized=1, visible=1,
legacyGate=1, and matches=16, with sixteen `FFFFFFFF` reference pixels and five
loaded sun textures. Its screenshot visibly contains the bright sunburst,
large translucent flare circles and smaller colored flare sprites.
`build/native-farmland-steered-sun.json` and its screenshot establish the same
visible artwork and the same state values in the original Wine/FEX game.
Both have the exact sun world position
`(134.56736755371094, 96.28237915039062, -280.59503173828125)`.
The browser reports no WebGPU errors or guest failure. With HUD/mirror hidden,
both games have 285 allocated textures; all dimension/format/mip-count
descriptors match as a multiset. `build/flare-visual-comparison.json` records
these assertions. Car/camera positions, animation timing and compositor scaling
differ, so this does not establish pixel-identical whole-scene equivalence.

The original sky loader at `00459660` exposes the sky binary directly as the
definition object for revisions 7/9. Sun initialization at `00460780` checks
the X/Z inputs at offsets `CDC`/`CE0`: both inside the strict ±0.02 interval
disable the sun. These are source position inputs, not angles or sky brightness.
The normal camera can put an enabled sun outside the view: Skidpad has an
active but uninitialized sun above the screen in both versions. Monaco1 has
an inactive sun in both. All five supplied Monaco layouts disable it, so
their bright textures are unsuitable for this flare comparison.

`tools/sky_inventory.py` now makes scene selection reproducible from staged
assets. It reports revision, sun enable/input/scale and revision-9 weather
key counts/ranges, rejecting unsupported/truncated or non-finite definitions.
Revision-7 weather is explicitly unparsed. Separate lightning files are
excluded. The report contains 17 sky definitions, including 15 revision-9
curves, and six sun-enabled tracks: Castle, Coastal, Farmland, Industrial,
Skidpad and Alps. Only Autobahn has nonzero rain and only Alps has nonzero snow.

Validation:

- Inventory sun flags match native Monaco1, Skidpad, Alps, Coastal, Farmland
  and Forest snapshots. Weather counts/ranges agree with the existing
  Autobahn/Alps controls and the prior precipitation inventory.
- The inventory command, Python compilation and `git diff --check` pass.
- All diagnostic browser sessions were stopped/disposed and native games
  terminated through Wine after observation. The temporary browser sun sampler
  was removed. Original installation files remain read-only.
- No engine or renderer code changed. The existing 87,957,695-byte Wasm module
  retains SHA-256
  `d3e72020397f34bcfaee89cafae0fc6ade50dd41970f90e4a00a21635bc8a29a`.
  Its prior unit/browser/renderer results remain applicable.

Ignored evidence includes `build/sky-inventory.json`,
`build/flare-visual-comparison.json`, `build/{native,browser}-farmland-*`,
`build/{native,browser}-skidpad-*` and the Monaco control snapshots.
Stencil-dependent scenes, broader visual equivalence, campaign/gameplay
completion and the performance target remain unverified. The goal is incomplete.
