# Native rain and snow artwork

Continued the visual audit before performance work. Original direct-race
configuration now provides live Autobahn and Alps comparisons without
changing saves or invoking guest routines inside an active runtime.

Both versions ran at 1152×864×32 with active texture/car tiers 4. Autobahn
starts at sky position 52, interval `[0,1]`, with rain 1 at both bounding keys.
Both render rain and translucent windshield droplets. The cockpit includes
the wiper geometry; its animation was not separately isolated. All 144 weather
keys (6,912 bytes) and the multiset of all 260 texture dimension/format/mip-count
descriptors match the native game.

Alps starts at sky position 44 with no precipitation in both versions. Driving
with ordinary keyboard acceleration and the game's reset control reaches its
snow section. Browser position 532 shows snow at interpolated intensity
0.308517; later browser position 681 and native position 702 both use interval
`[18,19]`, snow intensity 1. Both display heavy snow and blue fog. The full 37
weather keys (1,776 bytes) and all 255 texture allocation descriptors match.
The browser runs remain live without guest failure or WebGPU errors through
these observations. An earlier all-AI player configuration exited during
loading in both versions; the human-player configuration loads and drives.
The D AI-drive control did not take control in these runs.

These are effect-presence and data comparisons. The cars' later positions,
animation times and compositor scaling differ; browser HUD scaling also
intentionally differs from the native fixed-size HUD. The captures do not
establish texture-pixel or whole-scene equivalence.

The supplied native startup trampoline discards the game command-line options:
the CRT command-line buffer contains them, but the game sees only argv[0].
`tools/native_reference.py --fe-config <project-local-file>` therefore mounts
a race fixture read-only over the reference copy's `fe.txt`. The fixture uses
original keys, including `debugmode=0` to enter the race directly. Use a fresh
`--reference-dir` so the Wine server starts with that mount. A reused server
did not observe the new overlay. Some restarted-reference memory reads also
failed with access errors despite targeting an active process; a fresh prefix
resolved the reads. The earlier stale-process hypothesis was not established.

`tools/native_sun.py --reference-dir` selects the same reference copy for its
read-only snapshots. The memory reader reports target process and exit status
to distinguish a live target when diagnosing read errors. The source Wine
installation remains read-only; the underlying copied `fe.txt` is unchanged
after its overlay is removed. Browser command-line fixtures are installed
before startup in isolated, non-persistent sessions.

Validation:

- Live native display, quality, texture and weather snapshots succeed for
  both tracks. Browser/native metadata and weather bytes match exactly.
- Fixture dry runs verify the read-only mount and reject missing files and
  files outside the project. Default launches have no fixture mount.
- Python compilation and `git diff --check` pass. The updated native memory
  reader compiles with `-Wall -Wextra` and was used for successful snapshots.
- Both diagnostic native games and their browser sessions are closed after
  observation. The underlying Autobahn and Alps reference `fe.txt` copies
  still match the staged original byte for byte.
- No engine or renderer code changed. Wasm SHA-256 remains
  `d3e72020397f34bcfaee89cafae0fc6ade50dd41970f90e4a00a21635bc8a29a`.
  Existing unit, renderer and browser suite results remain applicable.

Ignored evidence: `build/{autobahn,alps}-visual-comparison.json`,
`build/native-autobahn-fresh*`, `build/browser-autobahn-*`,
`build/{native,browser}-alps-human-*`, and
`build/{native,browser}-alps-{snow-live,heavy-snow}*`.
Maximum-quality equivalence across scenes, visible flare artwork,
stencil-dependent scenes, full gameplay and the performance target remain
unverified. The goal is incomplete.
