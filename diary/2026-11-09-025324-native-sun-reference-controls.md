# Native sun reference controls

Continues visual-fidelity verification before performance work. The previous
commit was `28f7ffa`, adding indirect read-only native memory snapshots.

`tools/native_sun.py` now runs the existing reader through the isolated reference
prefix and records display mode, sun projection, initialization/visibility,
reference pixels and texture count as JSON alongside raw dumps. `--window`
also captures the specified X11 window. Outputs and the reader must remain in
this checkout. A null frontend sun is reported as null, with any old sun dump
removed; read errors remain errors. Reports explicitly identify the separate
live reads/image as non-atomic observations. README documents the command.

Validation:

- The real native frontend produces 640×480×16, a null sun and its screenshot.
- The real Schwarzwald race produces 1152×864×32 and an inactive, uninitialized
  sun, with zero reference pixels. This is another control demonstrating that
  a rendered sky does not imply the scene enables the sun effect.
- The decoder matches six earlier native snapshots covering active/inactive,
  initialized/uninitialized, in-view/offscreen and mirror-on/off observations.
  Truncated input is rejected. An output prefix outside the project is rejected
  before writing files. `git diff --check` passes.

Native Côte d'Azur initializes format 4 and sixteen `FFFFFFFF` reference pixels,
matching the browser's earlier initialization. Forward/look-behind observations
at the start have zero matched samples. Turning the native rear-view display
off through its menu also leaves zero matches in that starting area; this does
not establish or exclude a mirror-related defect in another view. The reference
copy retains this temporary mirror-off preference; the original installation
is read-only and browser preferences were not changed by this experiment.

Native reverse Normandie has the same sun world position observed in the browser:
approximately (134.567,96.282,-280.595). Looking behind initializes format 4 and
white references, projects the sun inside the screen, but still finds zero
matches; the screenshot places that point on the gorge wall. The reverse start
therefore did not provide the unobstructed sun view sought. Track direction and
menu difficulty labels must not be mistaken for a matched camera/scene test;
the suspected difficulty explanation was not established.

Browser Normandie remained at 6144×3162×32 with texture/car tiers 4, lens-flare
preference 1 and MMX enabled, without runtime/GPU errors. Additional observations
during draw submission also found no positive visibility state in that paused,
offscreen-sun view. The diagnostic browser was stopped/checkpointed and restarted
with the same persistent profile, removing temporary observation wrappers. The
fresh stretched frontend retains its button highlights and gradients. The
isolated native game process was terminated after the audit.

Ignored evidence includes `build/native-sun-{frontend,race}-check.*`,
`build/native-sun-scene-audit.json`, `build/native-cote-*.png`,
`build/native-normandie-reverse-*.{png,bin}`, `build/visual-audit-*.png` and
`build/visual-audit-browser-saves.json`. No engine/renderer behavior changed in
this turn, so its existing suites were not repeated. Visible flare artwork,
weather, broader gameplay and the performance target remain unverified; the
implementation goal is incomplete.
