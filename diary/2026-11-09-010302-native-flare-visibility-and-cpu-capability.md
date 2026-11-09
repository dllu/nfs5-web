# Native visibility hooks and MMX capability

Continues the visual-fidelity audit before performance work. The preceding
turn committed the isolated native reference tools in `b2b13ad`.

The supplied Verok DLL's installer at `10003390` replaces four framebuffer
readback calls with its helper at `10003320`. This is guarded color readback,
not depth sampling: signed coordinates clamp to the display, retaining the
native one-pixel edge margin. The browser now dispatches that private helper
through the existing guest callback bridge, preserving its five-argument
stdcall behavior without adding a public Thrash export. Generation redirects
the four original callers and applies the DLL's three flare visibility/timing
branch changes. Preparation validates every hook and labels the manifest;
the build rejects stale generated output without those hooks.

Live inspection then found a separate prerequisite. The original sun-object
initializer at `00460290` checks global `005DEB18` and permanently disables
sampling when it is zero. This global is the original CPU probe's MMX flag,
extracted from CPUID leaf 1 EDX bit 23. The upstream portable CPUID helper
hid MMX, although integer MMX translation already exists. The checkout-local
runtime header adapter now reports integer MMX support while continuing to
hide unsupported SSE and 3DNow paths. The pinned dependency remains untouched.

Validation:

- `npm test` passes. Its independent original-x86/Unicorn comparisons now
  include the actual MMX copy routine at `005B02C0`, with block thresholds,
  all destination alignments and overlapping ranges: 298 comparisons across
  seven routines, including 97 added MMX cases.
- New visibility checks execute the unmodified native DLL helper and original
  flare-update routine in Unicorn with the DLL's actual byte patches. All 64
  guarded-readback comparisons and 14 visibility comparisons pass. They cover
  negative/edge/large coordinates, 16/32-bit pixels, 4K/6K, matched/occluded
  samples, disabled settings, inactive objects, the removed legacy gate, and
  the removed sample-timing/slow-readback suppression. Expected results do not
  use generated C. CPUID checks execute the original game's wrapper.
- `npm run test:renderer` passes: 143 backend checks, 285 native-driver checks,
  446 ABI calls. Added real-GPU checks exercise the private wrapper's corner
  sampling, one-pixel margin, origin clamp and the raw driver's unchanged
  rejection of invalid rectangles.
- `npm run test:browser` passes. The original startup's CPU probe now sets
  its MMX flag to 1. Existing checks confirm maximum-quality properties,
  the physical viewport mode, actual menu-gradient pixels, intro/audio,
  persistence, viewport resizing, input mapping and Stop/restart.
- A fresh manual Chrome race at 6144×3162×32 reaches original initialization
  and repeated visibility updates. The live sun object's state is 1 (sampling
  initialized), its reference samples are opaque white, and its sample counter
  advances/resets during driving. Before the CPU correction its state was 2
  (permanently disabled), with no samples. Texture and car tiers remain 4;
  the race reports no WebGPU errors or runtime failure.

The observed sun positions during driving were occluded or outside the view;
their matched-pixel count remained zero. This establishes initialization and
continued sampling, not a matched-image comparison of visible flare artwork.
Visible flares, nighttime projected headlights, other effects and broader
gameplay still need comparison. No FPS result or 4K/120 Hz claim is made.

Local evidence: `build/visibility-differential.json`,
`build/visibility-live-audit.json`, `build/visibility-mmx-{chooser,setup2,race,driving,paused}.png`,
and `.cache/{build,unit,renderer,browser}-visibility-mmx.log`.
The 87,948,704-byte Wasm module has SHA-256
`c71192a7df990cd21e8005329b7bce4f24141609e7f1b8a654dda6594dfb82c9`.
Binary-derived data and screenshots remain ignored build artifacts.
