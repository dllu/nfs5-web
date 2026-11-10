# Extended scene visibility and model detail

Implemented a live, browser-local view-distance preference in Info. Automatic
uses Far (2×) on desktop hardware and Original on touch/software devices. Very
far (4×) and Original are explicit choices on every device. Game profile sliders
and saved career files retain their existing values.

The original game already used maximum exposed sliders. The new translation
hooks operate beneath those settings:

- After the main view recomputes its section range (00468A68), scale the native
  clamped range at 6197CC before publishing the camera's linear/squared bounds.
  Every frame starts from a freshly computed original value; live switches cannot
  compound. The original projection, track visibility selection and fog remain.
- Extend independent 600/700-unit scenery cutoffs (0047FA08/0047FA3D) by the
  squared multiplier. Keep shared constants and real culling/occlusion distances
  intact. Bias only the squared-distance arguments handed to scenery model
  renderers (0047FA20/0047FA55/0047FAB2) by the reciprocal squared multiplier.
- Increase cars' logical projected extent at the LOD/three-pixel visibility
  decision (0043A2E5). Preserve native mesh-count clamps, five quality tiers,
  cockpit, player, damage and special-car paths. Asset geometry is unchanged.

Preparation checks all seven instruction hooks, including shared-tail copies;
the build rejects stale translation metadata. Native mode resets to Original;
the runtime resolves Automatic after selecting the actual graphics adapter.
Info diagnostics include multiplier, native/effective section range and counts
of main views and car/scenery LOD decisions. Selector keys do not feed driving
input. Preferences survive a full browser restart separately from profiles.

## Verification

`npm test` passed, including 216 independent Unicorn x86/Wasm section-range
comparisons across all four tiers, section distances, the 50-unit minimum and
camera/FOV exception. Existing 260 native quality and 428 projection/camera
comparisons still pass.

Hardware Chrome tests used a private GLES2 headless Sway output on the NVIDIA
GB10 with muted audio. No desktop browser window or Wine run was used. Live
1080p races switched Original → 2× → 4× → Original, then drove at 4× on three
tracks. Screenshots show additional distant scenery; returning to Original
restores the native section range. Shared Wasm allocation stayed at 384 MiB in
these single-car samples.

| Track | Native range | 2× / 4× range | Vertices/frame Original / 2× / 4× | p99 submission interval Original / 2× / 4× |
| --- | ---: | ---: | ---: | ---: |
| farmland | 290.7 | 581.4 / 1162.7 | 9681 / 11020 / 11328 | 36.5 ms / 33.8 ms / 36.8 ms |
| coastal | 357.8 | 715.5 / 1431.1 | 11750 / 15331 / 14903 | 24.3 ms / 24.9 ms / 24.4 ms |
| castle | 421.1 | 842.2 / 1684.5 | 11072 / 13522 / 13748 | 36.5 ms / 34.9 ms / 30.2 ms |

These are short, sequential stationary samples with normal scene animations;
the CPU regression suite overlapped part of the run. They verify more geometry
and no obvious large frame-time regression on this GPU, not a universal frame
rate or long-session stutter benchmark. Track-authored visibility and fog can
still hide distant geometry; this reduces distance/LOD pop-in without claiming
to remove every transition. The higher setting can cost more on other hardware.

Reports and screenshots: `build/detail-browser.json`, `build/detail-*.png`,
`build/detail-native.json` and `build/detail-suite.log` (ignored).

Additional release checks passed:

- GT1/Auvergne, four opponents, **4× detail** at 1280×960, 3840×2160 and
  6144×3456. Driving advanced 190, 187 and 181 frames over the respective
  3.5-second samples. Both car and scenery LOD decisions continued throughout.
  Shared Wasm allocation was 384 MiB at 1280×960 and 460.8 MiB at 4K/6K;
  this includes the original race-loading/readback allocation behavior.
- Hardware renderer: 154 backend checks, 287 native-driver checks and 450 ABI
  calls; native shader fog, geometry and gamma comparisons passed.
- Touch/button/joystick input, simultaneous pedals/steering, Escape and selector
  arrow-key isolation passed.
- Packaged public page: direct launch, completed Showroom, new career defaults,
  original-density 4:3 frontend, graphics/audio diagnostics, live selection,
  browser-restart preference/profile persistence and tab-close guard passed.

Release revision: `6c4db2686b2735e4`. Wasm SHA-256:
`26f51b05099b41ba06290e379656884dbf035192019d0447c6edb85e28b681f6`.

Deployed to `pupserver.linode:/www/misc/nfs5` and verified the live public URL
in the private browser: matching release version, cross-origin isolation,
hardware autostart, Automatic selecting 2× and a live switch to 4×. No page errors.
The original development server and desktop compositor were preserved.
