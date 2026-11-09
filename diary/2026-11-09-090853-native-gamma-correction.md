# Native gamma correction

The visual audit found that Thrash gamma states 46 and 101 were accepted and
cached, but never affected browser shading. The original game sends state 46
when initializing video and changing its gamma preference. Its calls through
`006BD918` reach the same setter as `006BD97C` (assignment at `005752D5/F4`).
The game converts its integer preference to a float and clamps it to at least
0.25. The saved/default value 100 produces gamma 1; brightness remains a
preference rather than an additional detail tier to maximize.

The supplied OpenGL3 DLL's handler at `1000682D` multiplies that value by its
configured gamma factor, uploads the float product, and uses its float
reciprocal to correct the raw clear color's RGB. Clear alpha is unchanged.
Its embedded fragment shader applies the same RGB power after texture,
specular, alpha testing and fog. The `GAMMA` option's unsigned conversion,
float rounding and range check execute at `10002612..1000267B`; option 5 is
neutral, 0 gives factor 0.5, 10 gives 1.5, and out-of-range results fall back to 1.
The staged `OGL_GAMMA=5` therefore preserves the default image.

The replacement now carries gamma through transport v7 (41 state words,
164 bytes) into an 80-byte effects uniform. WGSL performs the original final
fragment operation, preserving alpha. Full and scissored clear commands encode
the corrected native clear color for the RGBA8 target. State aliases and stages
retain separate raw caches while updating one rendering value, including the
native no-op when a previously cached alias value is repeated. Inspection of
the native framebuffer helpers at `10008090` and `10003DC0` shows eight temporary
state overrides, with gamma retained; the browser transfer draw retains it too.
Consumers of transport versions 1–6 continue to use neutral gamma.

## Validation

`tests/gamma_oracle.py` runs the original DLL's configuration arithmetic,
state dispatcher, cache and gamma/clear handlers in Unicorn. GL calls are
recorded; `_CIpow` is replaced with a host double-precision power callback using
the original x87 calling convention. Both implementations use a controlled
initial opaque-black clear color. This checks driver math and command values,
not GPU rendering or the original CRT's last-bit power behavior.

`tests/gamma.mjs` passed 161 comparisons across seven configurations: unset,
0, 5, 6, 10, 11 and -1. Gamma products match native float bits exactly. Clear
components differ by at most 0.501 of an RGBA8 step from native GL float
arguments. Cases cover aliases, repeated cached values, stage-local caches,
black/white and colored clears, unchanged alpha and scissored clears. The test
also exercises the actual JavaScript state decoder and uniform builder, plus
seven framebuffer gamma forwarding checks. It uses isolated runtimes with no
active game. `npm test` passed completely on the final build, including the
updated packet offsets and existing native texture/fog/filter comparisons.

The updated WGSL passes parsing and semantic validation with pinned Naga
26.0.0. The checkout-local validator also confirms the effects structure's
80-byte span, gamma offset 64 and both entry points. Its source, Cargo lock,
downloads and output stay under `.cache/wgsl-check` and `.cache/cargo`; the
installed Rust compiler was only read. Log: `.cache/wgsl-gamma.log`.

`tests/native-shader.mjs` now includes 64 comparisons against the DLL's
unmodified GLSL across eight gamma values, textured/untextured fragments and
four fog modes, with specular and non-opaque alpha. These cases are **pending**.
At 09:05 PST the final engine's check timed out during Chrome launch after
30 seconds, before obtaining an adapter or rendering any case. Its exact
process handle completed with exit 1 and its test browser closed. The harness
now writes a dated, engine-hashed pending/failure report before browser launch
and bounds the pixel operation to 55 seconds. Existing older GPU reports must
not be mistaken for validation of this shader.

Evidence: `build/native-gamma-states.json`, `build/gamma-validation.json`,
`build/native-shader-validation.json`, `.cache/unit-gamma-final.log` and
`.cache/native-shader-gamma.log`. Final engine: 87,964,152 bytes, SHA-256
`20b3aea132d96afd48ed905f0d4b406687f336a39816f5a869d35cc99e41460b`.

The display-driver stall still prevents fresh hardware visual verification of
loading frames and gamma. No native game was launched and no GPU, display or
user browser was reset. Full visual equivalence, full gameplay and 4K/120 Hz
remain unestablished; performance optimization remains deferred.
