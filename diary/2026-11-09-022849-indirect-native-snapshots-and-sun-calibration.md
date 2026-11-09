# Indirect native snapshots and sun calibration

The preceding turn made concrete progress in `42bcb22`: repeated runtime
disposal is safe, and the industrial-track projected headlights were compared
against the native game. Visual-fidelity work continues before optimization.

The read-only native memory helper now accepts `@address`. It reads the 32-bit
pointer stored there, then snapshots the requested number of bytes at the
target. Existing direct-address usage is unchanged. Null pointers and failed
pointer reads return an error before creating an output file. This permits
inspection of the original live sun object through global 00627E5C without
manual pointer transcription or any process-memory writes. Pointer resolution
and the subsequent live-data read are not an atomic snapshot.

Validation used the actual reference process:

- The helper builds with the installed i686 LLVM/MinGW compiler using
  `-Wall -Wextra -O2`, without warnings.
- A direct read of the Thrash readrect function and an indirect read through
  006BD96C return identical 32-byte code snapshots, SHA-256
  `941df63901944ca20a26529b61ca548383a3f734bd5725b289d7206be264d1e3`.
- Following 00627E5C in the frontend reports a null pointer and exits with
  status 5, without producing a sun dump.
- Following that global in a running native race successfully reads the
  416-byte sun object at 02EB59D8. The helper still opens the game with only
  query/read process access.

The previous reference process was confirmed terminated (its tool handle
returned status 143 and its window/process were absent) before relaunching
the existing isolated prefix. Source installation files remain read-only.
Sway focus and a borderless floating 1728×1296 reference window give reliable
native input and a 4:3 presentation. Native and browser frontend state both
report 640×480×16; that color mode is not a newly identified discrepancy.

Browser Normandie renders at 6144×3162×32 with texture/car tiers 4, lens-flare
preference 1, MMX enabled and initialized visibility sampling. Observations at
presentation and during existing framebuffer readbacks found zero matched
samples in the views tried: the sun was behind trees or outside the view.
The inspected readback pixels are non-white. Camera/look/reset controls and
brief driving were exercised, but these views do not establish visible flare
artwork or a rendering defect.

The native Pyrénées scene provides an important control: at 1152×864×32 its
sun object has active=0 and initialized=0, with zero samples and references.
The scene's blue sky does not imply an active sun. It is therefore unsuitable
for the intended visible-flare comparison. Work continues on a sun-enabled
scene and on whether the rear-view overlay affects visibility sampling.

Evidence remains in ignored artifacts: `build/native-indirect-memory-check.json`,
`build/native-{direct,indirect}-code.bin`,
`build/native-pyrenees-{sun.bin,flare-state.json,race.png}`,
`build/flare-normandie-*.png` and `.cache/native-flare-reference.log`.
No renderer/engine behavior changed, and engine test suites were not repeated
for this read-only diagnostic extension. Visible flares, weather, broader
gameplay and the 4K/120 Hz target remain unverified; the goal is incomplete.
