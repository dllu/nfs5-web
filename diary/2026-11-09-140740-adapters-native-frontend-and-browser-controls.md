# Hardware adapters, native frontend density and browser controls

The public game requests a high-performance hardware adapter, then tries low-power,
default and compatibility preferences before accepting a software adapter. The
browser still decides which GPUs are exposed. The Windows RTX 2080 Ti machine has
not been tested; its hardware inventory cannot establish its selected WebGPU
adapter. Info → Copy diagnostics reports browser, adapter, logical/output size,
Wasm allocation and GPU queue counters without telemetry.

Reduced initial shared Wasm memory from 512 to 384 MiB, retaining growth, the
256 MiB guest arena and eight guest workers. GPU presentation now allows at most
two unfinished frames, preventing unchecked accumulation when a software renderer
falls behind. This does not measure displayed FPS or bound all browser/GPU memory.

Hardware frontend rendering uses the physical fitted 4:3 target while preserving
640×480 layout, projection coordinates, videos and mouse hitboxes. Geometry is
rasterized at that density; bitmap assets retain their original detail. Scissors
scale to the target. Legacy framebuffer locks/read rectangles see a downsampled
logical surface, preserving the game's CPU interface. Races retain native sizes
and arbitrary aspect. Software adapters keep the small frontend target.

Added touch/pen menu clicks, a virtual steering/throttle joystick and pedals,
handbrake, camera, Pause and a mobile name-entry field. Controls share keyboard
state by source, release on blur/cancel and do not send clicks through to the game.
Quick Escape presses stay down long enough for the original keyboard poll; key
fallback accepts Escape when the physical code is unavailable. Text-field focus
survives a soft-keyboard viewport resize.

The public page guards close/reload with beforeunload while the game runs and
removes it on completion. Written files still checkpoint every second/on hiding;
Quit to Windows remains the reliable way to serialize career state. Browser
confirmation text/availability, especially mobile, is browser-controlled.

Blur releases controls without sending native focus loss. Visibility updates
cancel a pending animation-frame wait and pace hidden rendering with a 30 Hz
atomic wait, so loading and simulation continue. OS/browser suspension still wins.

## Verification

- Full native/Wasm suite passed at the smaller initial allocation, including
  seven blocked workers, memory growth, graphics transport and cancellation.
- WebGPU: 151 backend checks, 287 native driver checks and 450 ABI calls; native
  shader comparisons; added high-density scissor/readback and two-frame checks.
- Chrome browser input/audio/files/intro/lifecycle and original options navigation
  passed. Native-color navigation tests explicitly retain a 640×480 test target;
  public checks exercise monitor-density output.
- Wide, portrait and 4K loading captures retain 4:3 artwork and correct margins.
- Actual touch input, joystick, soft keyboard text, short/fallback Escape, Pause
  and focus release passed browser checks. Public profile creation uses the mobile
  name-entry field and verifies fresh 1950 data and browser-restart persistence.
- Raw-CDP Chrome test bypasses Playwright's forced visibility: hidden loading
  advanced from 2 to 14 frames; the race advanced 93 frames during a four-second
  hidden interval. A quick Escape showed the original pause menu; Continue
  resumed it. Race Wasm allocation stayed 384 MiB and queue peak was two.
- Inspected the actual garage car at 1920×1440 with logical 640×480 coordinates.
  Native Quit to Windows saved, completed and removed the tab-close guard.
- Isolated Firefox still selects llvmpipe after all adapter hints. The real race
  runs with the software pixel limit and a two-frame queue; no renderer errors.
  Submitted-frame rates are not displayed-frame measurements.

The initial live check exposed a stale Cloudflare stylesheet despite origin
no-cache. Public packaging now versions all code dependencies by release content,
including CSS, Wasm and pthread URLs. Profiles/IndexedDB identity stay unchanged.
Physical Windows, Mac and mobile devices still need user verification. No Wine
processes or files were used. Public release is deployed to pupserver.linode at
/www/misc/nfs5 and served at https://daniel.lawrence.lu/nfs5/.

Final public revision: `fd40de5cfa98e846`. The versioned release passed the full
public check on the deployed URL, including fixed-position controls with fresh
CSS, mobile field focus through a viewport resize, 384 MiB diagnostics, cancelled
beforeunload confirmation and byte-identical profile persistence after restarting
Chrome. The final raw-CDP race check also passed using an automatically chosen
local debugging port.
