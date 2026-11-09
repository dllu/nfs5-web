# Native weather keys and interpolation

Continued the visual audit before performance work. Pyrénées now has a live
native/browser comparison: the same blue forest starting area renders in
Chrome at 6144×3162×32, texture/car tiers both 4, without WebGPU errors or
guest failure. The native reference uses 1152×864×32. These are scene checks,
not a pixel-identical comparison across different aspect ratios.

Tracing the original weather update identified sky pointer `00627E48`, its
controller at `sky+48`, and 48-byte weather keys. Original `0045A490` constructs
the controller; `0045D000`/`0045A8E0` return interpolated rain from key offset
`18`, and `0045CFD0`/`0045A940` return snow from offset `20`. Both use original
`0045A560` interval selection and cyclic-track interpolation.

The browser's complete two-key Pyrénées data matches all 96 bytes in the live
native game and the supplied `GameData/Track/Sky/foothills.bin` at `1A5C`.
The positions are 0 and 287; both rain and snow are zero at both keys. This
scene therefore cannot establish visible precipitation fidelity. Its native
sun is also inactive and uninitialized.

An inventory of the fifteen supplied version-9 sky-data files finds nonzero
rain only in Autobahn (144 keys, maximum 1) and snow only in Alps (37 keys,
maximum 1). The other version-9 files have zero precipitation. Older format
files and the separate lightning data were excluded from this inventory.
The current profile's eight-track quick-race list excludes Autobahn and Alps;
the list still had eight entries after selecting Expert. No save-unlock
modifications or live guest-routine injections were used to bypass that.

`tools/native_sun.py --weather` now records the live sky/controller addresses,
position, cached interval indices, precipitation keys and ranges alongside
its display/sun snapshot. It uses only the existing read-only memory reader.
Count/index validation, finite-value checks and complete-record checks reject
malformed data. A frontend with no sky reports null weather and removes stale
weather dumps from the same output prefix. All observations remain explicitly
non-atomic. The original installation stays read-only.

Added `tests/weather.mjs` to `npm test`. It executes original x86 weather-return
routines in Unicorn and compares them with the isolated Wasm runtime, using
the actual Autobahn, Alps and foothills curves plus a synthetic cyclic
boundary. All 136 comparisons match exact returned doubles, CPU registers
and controller interval state. Cases include key positions, interpolated
positions, stale cached intervals, zero precipitation, wraparound and positions
just outside the track range. No game is running inside the test runtime when
its guest functions are called.

Validation:

- `node tests/weather.mjs` and the full `npm test` pass.
- Real native race and frontend snapshots pass with `--weather`; the frontend
  null-state check also verifies removal of deliberately seeded stale dumps.
- Decoder checks match native/browser keys and reject truncated, oversized,
  negative-position and non-finite precipitation records.
- `python3 -m py_compile tools/native_sun.py` and `git diff --check` pass.
- The reference process was terminated after its observations. Chrome remains
  on the paused 6K Pyrénées scene, with no renderer observation wrappers.

Engine/renderer behavior did not change in this turn. The existing Wasm SHA-256
is `d3e72020397f34bcfaee89cafae0fc6ade50dd41970f90e4a00a21635bc8a29a`;
its renderer/browser suites passed in the preceding capability audit and were
not repeated for these diagnostic/test changes. README reflects the current
weather evidence and inspection command.

Ignored evidence includes `build/native-pyrenees-*`,
`build/browser-pyrenees-*`, `build/native-weather-frontend*`,
`build/track-weather-inventory.json`, `build/weather-differential.json`,
and `.cache/{weather-differential,unit-weather,native-weather}.log`.
Visible rain/snow artwork, flare artwork, stencil-dependent scenes, full
gameplay and the performance target remain unverified. The goal is incomplete.
