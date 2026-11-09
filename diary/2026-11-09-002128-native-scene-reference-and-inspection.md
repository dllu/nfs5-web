# Native scene reference and read-only inspection

Continues visual-fidelity verification before performance work. The preceding
goal turn made concrete progress in `0e813e0` (loading artwork and UI strokes).
No engine/rendering changes were needed for the sky check in this turn.

`tools/native_reference.py` runs the installed Wine/FEX game from a project-local
copy of its prefix. It copies with `cp -a --reflink=auto` on first use and keeps
the copy's settings/saves independently. Bubblewrap mounts the host filesystem
and source prefix read-only, exposes the project as writable, and uses
project-local temporary/cache directories. This avoids changing `~/wines`.
Alternate Wine commands can run through the same environment after `--`.
The default dependency paths match the supplied DGX Spark installation.

`tools/native_memory.c` is an optional 32-bit Windows helper. It locates the
reference game's Porsche window and uses `ReadProcessMemory` with read/query
access to snapshot an explicitly requested address range. It neither injects
code nor changes the target's memory. Live data snapshots are not atomic.

Evidence gathered:

- The cloned native game launches and reaches its original frontend and races.
  Its graphics menu confirms Very High texture/car/world/distance and High sky.
  Projected headlights were selected in the copy; its saved property is 1.
- Native Côte d’Azur at 1152×864×32 has the same pink sunset appearance seen in
  the browser. This comparison establishes the expected scene appearance,
  rather than exact image equality across different profiles/cameras.
- Capturing and replaying the browser's five actual sky submissions in an
  independent WebGPU target renders a sunset gradient: 152 triangles and
  527 distinct RGB values in the sampled upper region. Projected, indexed
  vertices have valid normalized depths. The flat-looking visible pink region
  is insufficient evidence of a sky-rendering bug.
- The native Zone Industrielle race renders dark buildings, rain, streetlight
  glows and the road. Browser/native player profiles expose different car and
  track lists; matching those selections remains necessary for the headlight
  comparison. Changing opponent difficulty alone did not align the lists.
- A browser race-to-menu return completed without a runtime error. Several
  intermediate captures showed its loading transition. A readback probe outside
  presentation was unreliable; frame evidence should be captured at present.
- A read-only native runtime snapshot reveals 91 modified executable text
  spans. These include existing quality/projection hooks and additional patch
  work to audit, including lens-flare/visibility code near 004603FF/00460525.
  They are not all missing features: native windowing/timing adaptations also
  differ from the browser host. The list is an audit input, not an equivalence
  claim or an instruction to copy every native patch blindly.

Validation: the launcher ran `cmd /c ver` successfully. The memory helper built
with the installed i686 LLVM/MinGW compiler using `-Wall -Wextra`; it reproduced
the native 1,763,008-byte text snapshot exactly in two reads. The launcher rejects
an external writable reference directory before mutation. Engine test suites
were not repeated because production runtime/shader code is unchanged.

Local evidence: `build/native-reference-{coastal,advanced-ready,industrial-before}.png`,
`build/browser-sky-isolated.png`, `build/native-exe-patches.json`,
`build/native-runtime-{image,text}.bin`; logs `.cache/native-reference*.log`.
Binary-derived dumps and screenshots remain ignored build artifacts.

The full game, cross-profile catalogue behavior, projected headlights, remaining
effect fidelity and 4K/120 Hz target are not established by this work. Continue
the native-patch and headlight comparison before performance tuning.
