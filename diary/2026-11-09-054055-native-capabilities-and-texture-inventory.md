# Native capabilities and live texture inventory

Visual fidelity remains the priority. The WebGPU Thrash descriptor now reports
the native OpenGL3 capability flags, `0x0e`. The inherited `0x3f` incorrectly
advertised software rendering, configurable line width and window-mode
switching. The retained flags specify square, power-of-two textures. Other
descriptor fields describe this backend's capabilities and have not been
blindly copied from the original driver.

`tests/capabilities_oracle.py` executes the original DLL's descriptor builder
and per-property option-reader control flow in Unicorn. It assumes platform
initialization has finished and substitutes only platform string formatting
and absent INI/environment lookup calls. The driver SHA-256 is pinned to
`5a57e6c244ea40ea90d69cf13bd3b79144ebca0a980f1d7cb87af48197581f6f`.
`tests/capabilities.mjs`, included in `npm test`, failed against the old bridge
(`63` versus native `14`) and passes with the correction. The optional
`tests/descriptor_native.c` probe independently loads the real driver and
queries its descriptor in a separate Wine/FEX process; it also reports `0x0e`.

Added two read-only inspection paths for live texture comparison:

- `tools/native_textures.c` finds the reference game's OpenGL3 module and reads
  its texture list, descriptor flags and filter metadata using read/query-only
  process access. It reports incomplete traversals instead of silently accepting
  a cycle, failed read or list overrun.
- The exported `web_thrash_textures` host getter copies the bridge's live
  texture inventory under the machine lock. It includes formats, dimensions,
  mip counts and raw filter choices, without invoking guest routines or
  changing renderer methods. Framebuffer-copy textures are excluded.

The native reference ran from the project-local cloned prefix, with the source
installation read-only. A paused Côte d'Azur race used 1152×864×32, texture tier
4 and car tier 4. Its complete texture snapshot has 312 allocations, all with
zero additional mip levels: 227 format-6, 5 format-4, 50 format-7 and 30
format-3 textures. Raw spatial filtering is 1, mip filtering 0, override 1.
Thus the lack of live mip submissions observed in the browser also occurs in
the checked maximum-quality native race. The capability correction is valid
independently; this does not establish that the old flags caused a mip issue.

A fresh Chrome run with the new build renders the same race at
6144×3162×32, texture/car tiers both 4, with no WebGPU errors or guest failure.
The entire multiset of `(width, height, format, extraMips, paletteFormat)`
matches the native 312-texture inventory exactly. Raw race filter choices and
override also match. The frontend inventories likewise match all 76 entries.
The menu's raw spatial state differs (browser 0, native 1); override 1 selects
bilinear sampling in both. Menu gradients and the built-in portrait are
visible in the captured browser frontend.

Validation on the final build:

- Build succeeds: Wasm 87,957,695 bytes, SHA-256
  `d3e72020397f34bcfaee89cafae0fc6ade50dd41970f90e4a00a21635bc8a29a`.
- `npm test` passes, including the native descriptor check and existing
  quality/projection/fog/filter/visibility/portrait and host/lifecycle suites.
- `npm run test:renderer` passes: 143 backend checks, 287 native-driver checks,
  450 ABI calls, 18 native-GLSL fog comparisons and 17 geometry comparisons.
- `npm run test:browser` passes: startup/intro/audio, save persistence, input,
  maximum defaults, portraits, menu gradients, viewport scaling and lifecycle.
- Both optional native C probes compile and run through Wine/FEX. The native
  game was terminated after its snapshots; no original installation files
  were changed. No live renderer observation wrappers were installed.
- `git diff --check` passes. README describes the current comparison evidence.

Ignored evidence: `build/{native,browser}-{menu,cote}-textures.json`,
`build/native-texture-comparison.json`, `build/native-descriptor.json`,
`build/native-capabilities.json`, `build/capabilities-*.png`,
`build/native-mipmap-cote*`, and `.cache/*-capabilities.log`.

Matching allocation metadata does not compare texture pixels, scene geometry
or effects. Native and browser viewport/aspect ratios differ. Weather, visible
flare artwork, stencil-dependent scenes, full gameplay and the 4K/120 Hz target
remain open. The implementation goal is incomplete; performance optimization
has not resumed.
