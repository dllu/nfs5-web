# 4:3 menus and Firefox software adapters

The canvas now fits its native display aspect inside the browser, centered
against black. Original 640×480 menus and startup artwork stay 4:3. Race
modes keep their chosen aspect, including the full browser-sized widescreen
mode. Race loading artwork already uses centered 4:3 bounds inside that
framebuffer. Input continues to use the canvas bounding box, so the new
horizontal/vertical offsets also apply to clicks and mouse motion. The public
and development launchers share viewport.css; the development launcher restores
its normal document layout when play stops.

The installed Firefox 159.0 is an ARM64 binary. In a separate project-local
WebDriver profile, enabling WebGPU and ignoring its blocklist selected
llvmpipe (LLVM 20.1.2, Mesa 25.2.8), a CPU Vulkan adapter. Default, low-power,
and high-performance adapter requests all returned that fallback. The host's
vulkaninfo lists NVIDIA GB10 as well, so this establishes Firefox's adapter
selection in this isolated profile, not absence of a system GPU or the cause
of the friend's slowdown. Their OS/GPU/Firefox version remain unknown.

An original Côte d’Azur race, one player, maximum requested texture/car tiers,
was run in an OffscreenCanvas Worker under Firefox. Exploratory five-second
samples after warmup:

| Requested race mode | Submitted frames/s | p95 submission interval | Final GPU drain |
| --- | ---: | ---: | ---: |
| 1920×1080 | 58.57 | 19.00 ms | 2023.10 ms |
| 1280×720 | 59.16 | 17.40 ms | 6.22 ms |
| 1920×1080 with software default limit | 59.99 | 17.32 ms | 98.76 ms |

The final case selects 1280×720. These are queued renderer submissions, not
verified display FPS; the large 1080p drain demonstrates accumulated GPU work.
Single runs and different positions prevent a controlled speedup claim. All
samples have no WebGPU errors. An actual GPU-pixel capture of the final race
shows the cockpit, track and HUD at 1280×720. Firefox's default WebDriver page
screenshot returned black for the WebGPU canvas, so it was not used as visual
evidence. Probe JSON/captures remain in ignored build/firefox-* artifacts.

The public launcher opts into a software-only default pixel budget equivalent
to 1280×720. It preserves aspect and the original minimum 640×480 display;
hardware adapters keep their full viewport default. Explicit saved mode
choices are not rewritten. A short notice identifies software rendering and
suggests hardware acceleration or another browser. Adapter metadata is local;
no telemetry is sent. The renderer and runtime remain opt-in for tools and
other callers that need exact requested dimensions.

Validation:

- Public Chrome tests pass wide (1920×1080) and portrait (900×1600) centered
  4:3 menu bounds, profile creation through mouse clicks with letterbox offsets,
  maximum defaults, and identical profile bytes after closing/restarting Chrome.
- Twelve original loading updates at 1600×900, 900×1600 and 3840×2160 keep 4:3
  displayed artwork with black margins while the race-sized canvas fills its
  viewport. No GPU errors occurred.
- Firefox public-launch smoke check reports software:true, reduced:true,
  display 933×987 for its portrait-shaped viewport; the menu canvas is
  2048×1536 at y=315 inside a 2048×2166 window, with cursor:none and the notice.
- Startup configuration and seven software-display configuration checks pass.
  Existing blocked-wait, process-exit and lifecycle suites also pass.

No Wine reference was run and no external browser profile was changed. The
public package contains the new stylesheet and software-adapter handling.

The update is deployed at https://daniel.lawrence.lu/nfs5/. The full public
Chrome check also passes against that HTTPS URL, including both letterbox
orientations, mouse-offset creation and profile persistence across a complete
browser restart. The downloaded viewport.css exactly matches the checked
source. The separate Firefox/WebDriver session was closed after verification;
the user's normal Firefox profile was never modified.
