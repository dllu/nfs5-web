# NFS Porsche Unleashed on the web

Work in progress: the original PC executable is statically translated from x86
to C with pcrecomp, then compiled to WebAssembly with Emscripten. The browser
executes original startup code, plays the intro with game audio, and renders
the 3D frontend, main menu, profile chooser, quick-race setup and a race scene.
**The port is incomplete.**

Current implementation:

- A pinned lifter, checkout-local compiler/dependencies, reproducible generation,
  and a static browser launcher with diagnostics.
- 10,781 recovered function candidates from Verok 1.06 `nfs5.exe`, with original
  data sections, import dispatch, x87 helpers, a guest stack/TIB, CP1252 locale
  services, dynamic API lookup, and a tracked heap in a 256 MiB guest arena.
  Recovery includes overlapping instruction ranges;
  these counts do not establish complete code coverage.
- Startup reaches original `WinMain` (`0x004B6710`) and worker (`0x0055F4F0`).
  In Chrome 157 it creates the game window, selects a graphics mode, decodes
  the original intro video and streams its PCM through the browser audio graph.
  The launcher can run until Stop; startup checks use a wall-clock limit.
  Unbounded play skips function/graphics deadline clock reads while retaining
  Stop checks and renderer-failure handling. Finite diagnostic budgets also
  bound kernel-object waits, Sleep and an idle timer dispatcher.
  Node startup has no GPU attached.
- The opening-movie part of `nfs5.ini`'s `NoMovies` setting is honored through
  the supplied patch's original jump point in the static translation.
  Development runs can force playback with `loadRuntime({intro:true})`.
- Mutex/event/semaphore handles, recursive ownership, named references, and
  blocking waits are implemented. Object completions notify parked workers
  through shared-memory epochs; Stop, shutdown and errors wake object/timer waits.
  Native Wasm workers have separate CPU/FPU
  state, 4 MiB guest stacks, TLS and LastError; a lock serializes the lifted
  register file. x87 values and exact integer shadows use a circular eight-slot
  file, saved together on CPU switches. Up to seven guest workers can run
  alongside the primary thread.
- Browser startup runs off the UI thread. The static server supplies the
  cross-origin isolation headers required for shared Wasm memory.
  During play the canvas fills the browser viewport, stretching the original
  640×480 menus and the selected race mode. New players select a 32-bit race
  mode at the browser viewport’s physical-pixel size at launch; fixed choices
  retain their saved indices. Mouse movement, buttons and wheel
  coordinates follow that scaling across window resizes. Stop returns to the
  launcher and its final frame.
  Race HUD text, gauges, rear-view placement and pause controls use a separate
  logical UI canvas, preserving their anchors and readable size at 4K/6K.
  UI hit testing converts cached mouse positions and button-event coordinates;
  Windows and DirectInput retain physical coordinates. Interface lines/points
  and minimap strokes follow the UI scale, preserving projected minimap
  positions. The centered race-loading artwork uses the same scale, including
  its software framebuffer upload.
  Original `ExitProcess` calls end the guest, wake blocked workers and report
  the unsigned game exit code separately from Stop and runtime errors.
- Multimedia timers share one sleeping dispatcher and execute the original
  five-argument callback, including its one-shot rescheduling. Event timers,
  periodic dispatch, synchronous cancellation and pulse waits are implemented.
  Guest tick counters, input/message timestamps and performance counters use
  one monotonic origin shared by native workers.
  Local/UTC calendar APIs retain integer milliseconds; time-zone information
  includes current-year daylight-saving dates. More complex time-zone changes
  use a fixed current-offset snapshot.
- DirectInput keyboard/mouse devices execute original enumeration callbacks and
  expose immediate/buffered input, event notifications, relative mouse movement,
  and focus loss. Browser key events reach the Wasm device through the runner.
- DOS paths, case-insensitive files/directories, file sharing, duplicate handles,
  reads/seeks, enumeration, file copying and a 64 MiB memory write overlay are
  implemented. Copies preserve attributes and modification times, observe sharing,
  include pending mapped source writes and stage bytes before replacing a save.
  Staged assets load on demand through a shared 512 KiB range cache; Chrome and
  Node read the original startup data. Browser file changes persist in IndexedDB
  per origin/executable, checkpointing every second and when startup stops.
- File mappings use distinct guest addresses and shared backing, with named
  handles, overlapping views, eager private copies and writable-view checkpoints.
  A 512 MiB view address range has a 128 MiB backing limit. Lifted scalar, x87,
  SSE and bulk-copy helpers translate mapped addresses; aliasing copies retain
  x86 element order. Reservation, commitment and protection metadata are tracked.
  Forbidden page accesses are not trapped by the flat Wasm arena.
- DirectSound PCM buffers support locking, looping, playback cursors, shared
  duplicates, volume/pan, 8/16-bit mono/stereo and linear resampling. A shared
  stereo ring feeds an AudioWorklet; its real-time callback never takes a VM lock.
- Window classes, original creation/activation callbacks, client geometry,
  painting, thread-owned message queues, filtered blocking retrieval and
  keyboard/mouse messages are implemented. A virtual desktop exposes viewport
  geometry, device contexts and color depth; renderer mode changes keep the game
  window's client area and size messages aligned with the canvas. Memory status
  reports guest limits.
  Application registry keys retain the game's install-name fallback, typed
  values, access rights and browser-local persistence. Process environment
  snapshots support UTF-16 and CP437/OEM byte blocks.
- A WebGPU backend batches geometry and effect uploads, preserving Thrash
  screen-space projection, perspective UVs, flat/Gouraud diffuse colors,
  screen-linear specular RGBA addition, texture RGBA modulation, depth, blending,
  alpha tests, clipping, fog and texture-update ordering. All ten native custom
  source/destination blend factors and ABI-dependent blend/alpha modes are
  implemented; alpha reference updates are independent of test enablement.
  Stencil comparisons and pass/fail/depth-fail operations, clipped aspect clears,
  and independent depth-test/write controls are implemented. The backend prefers
  32-bit float depth with 8-bit stencil and uses the core 24-bit-plus/stencil
  format when that optional feature is unavailable. Supplied mip chains,
  separate spatial/mip filters, LOD bias and independent U/V clamp, repeat and
  mirrored-repeat modes are implemented. A 41-export Thrash
  replacement connects guest driver calls to an OffscreenCanvas through a
  bounded shared-memory queue, with chunked texture uploads, framebuffer
  reads/writes and mode changes. Queue writes, free space and completed barriers
  wake their consumers/producers through shared-memory notifications; older
  engines retain polling. The v6 consumer also accepts v1–v5 draw and texture
  packets. Flush queues an ordered submission without waiting
  for a consumer acknowledgement; presentation, readback, resize and reset
  retain their barriers. The original video decoder presents through
  framebuffer lock/unlock. The frontend submits original geometry and textures.
  The native renderer-extension probe enables the original menu gradients,
  highlights and shadows rather than its flat fallback.
  Verok’s texture-selection and five-level car-mesh hooks are statically
  translated from the supplied `nfs5.dll`; race textures honor the saved quality
  instead of the original CPU-based autodetection. Successful video-mode changes
  also update Verok’s aspect-dependent projection bases and camera field of view;
  projected effects and camera zoom use the corresponding native operands.
  Multitexture, projected headlights and broader 3D scene fidelity need further
  implementation/auditing.

Validation includes 201 original-x86/Unicorn versus Wasm comparisons across six
routines, 260 native Verok DLL comparisons for texture tiers and car layers,
260 projection calculations and 168 original camera/zoom comparisons,
56 UI layout checks using the original HUD anchoring routine,
plus 104 Windows-service, 38 virtual-memory, 54 synchronization,
70 thread, 60 exact x87 integer-state, 27 timer, 45 DirectInput, 85 filesystem/path, 93 file-copy, 86 mapping,
54 DirectSound, 31 registry, 98 window/desktop and 228 Thrash loader/ABI calls,
84 graphics-transport, 19 lifecycle and 10 startup-configuration checks. Another
43 blocked-wait checks cover signal races, seven parked workers, finite budgets,
normal completion, Stop and worker-error delivery. Another 23 process-exit
checks cover unsigned exit codes, seven blocked workers and callback-driven
exit during object, sleep, message, timer, compute and graphics waits.
The execution checks also
cover seven-worker sleep and original compute-loop contention, finite graphics
deadlines, cancellation in compute loops and disposal while a worker holds the VM.
Another 24,000 stack-model transitions check both x87 storage layouts against an
independent logical model, including special doubles, swaps and all eight slots.
Chrome verifies original startup,
physical key events, focus loss, native-worker HTTP range reads, and exact binary
file/deletion, mapped-file writeback and registry persistence across fresh pages
and Wasm instances. A known PCM
signal reaches the running browser audio graph with its expected amplitude.
An additional 15-second original-code run verifies advancing video, visible
pixels, timer callbacks and nonzero game PCM.
Chrome also verifies viewport fill at two window sizes, mouse/button/wheel
coordinates through stretched menus, unbounded Run game, cooperative Stop and
a fresh restart. An original frontend run verifies its capability-selected
Gouraud UI path and the actual button highlight/center/shadow pixels.
143 WebGPU pixel/batching checks pass on the GB10, including 3840x2160 output and
an OffscreenCanvas rendered in a dedicated Worker using the core depth/stencil
format. Another 261 checks exercise
the native Thrash bridge, including a 4K framebuffer round trip and command-ring
wrapping under texture-upload backpressure, asynchronous flush and reuse of
guest vertex memory before consumer execution. Pixel checks cover flat provoking
vertices and quad/sprite splits, diffuse/specular interpolation with unequal RHW,
specular ordering with texture alpha, alpha tests and fog, and shading changes
between queued draws, supplied mip colors, minification, mip blending, LOD bias,
rectangular mip chains and independent address modes. Repeated 5.3 MiB source
mip-chain uploads verify their last level through ring wrapping and backpressure.
All eight alpha comparisons, exact threshold boundaries, zero-alpha depth
rejection, all ten native source/destination factors, and the original game's
doubled-modulate blend helper are checked. Stencil checks cover all eight
comparisons, all eight operations on each outcome, byte-boundary clamp/wrap,
read/write masks, discarded fragments, selective/clipped clears and disabled
depth writes. Native checks include the fixed stencil reference/masks, auxiliary
fallback, depth-state independence and clear-aspect snapshots. Legacy v1–v5 packets decode
indexed/unindexed draws and textures, preserve alpha comparison defaults and
wake after idle. UI pixel checks cover scaled horizontal/vertical/diagonal lines, points,
Gouraud/flat colors, source attributes and projected minimap endpoints; scene
lines remain one physical pixel at 4K. These checks do not measure game FPS.

Manual Chrome navigation reaches quick-race setup and renders the Côte d'Azur
track and Porsche 356 at 6144×3162×32. Holding Up accelerates the car; the scaled
HUD showed roughly 60 km/h and second gear. Pause hover, Continue and driving
work with physical browser input; race restart has also been exercised.
The loading artwork centers at viewport height; minimap strokes and the damage
gradient remain readable at 6K.
Menu clicks can require retries. Broader input, fidelity and
performance need further verification. The original graphics menu selects a
4K race mode successfully.
Creating a player writes its original save and HUD files to browser storage;
the player reappears selected after a full browser restart, with identical save
bytes. Buying the first Evolution car (a 1950 356 1100 Cabriolet for 11,000),
confirming the game's Exit and restarting Chrome restores the owned car and
zero account balance, with identical saved bytes. Confirmed Exit writes career
changes; the launcher's Stop only checkpoints files the game has already written.
The main menu's Load Game opens the original player chooser. Race results and
campaign advancement remain untested.
Visual fidelity takes priority over further performance work. New graphics
properties default to Very High textures/car detail/world/distance, High car
lighting/sky, projected headlights and lens flare, with a 32-bit viewport mode.
Existing player saves retain their preferences. Chrome verifies these original
frontend properties and the selected mode's physical-pixel dimensions, alongside
the actual menu-gradient pixels. A new player’s maximum-quality save survives a
full Chrome restart byte-for-byte. Côte d’Azur renders at 6144×3162×32 with
texture and car tiers both confirmed as 4 in the original race state, without
WebGPU validation errors. Its live camera half-FOV is 48.195°, matching Verok’s
aspect calculation for that viewport. Full rendering of the selected effects,
including nighttime projected headlights, still needs verification. Stencil
behavior is covered by native-driver pixel checks; a completed in-game effect
comparison remains outstanding.
One menu-return memory fault remains unexplained; it did not recur in a fresh
run with a verified asset server.
Custom portrait conversion
is unavailable; the original caller uses its optional-converter failure path.
Other native-patch settings are not fully ported. Window APIs and
text input cover a limited subset; hooks and full keyboard-layout handling are
unsupported. An abrupt close can lose
changes since the last checkpoint.
The 4K/120 Hz gameplay target remains unmet. Representative performance at the
maximum visual settings and sustained performance across tracks remain untested.
The optimized Wasm module
is about 84 MiB and retains tracing and optional execution limits. The x87
helpers use double precision; English linguistic comparison uses an ICU
approximation of Windows NLS. Full floating-point and binary compatibility are
unverified.

## Build and inspect locally

Prerequisites: Git, Python 3.10+ with venv, Node 18+, and npm. All downloaded tools,
temporary files, build outputs, and browser profiles stay in this checkout.

```sh
python3 tools/bootstrap.py
.venv/bin/python tools/prepare.py "/path/to/your/installation/nfs5.exe"
python3 tools/stage_assets.py "/path/to/your/installation"
npm run build
npm test
npm run serve
```

Open <http://127.0.0.1:8000> and select **Run game** to run until **Stop**.
**Run original startup** performs a five-second check. The page reports
the next unsupported dependency or diagnostic time limit, retains its final
frame and lists recent original functions.
`npm run test:browser` tests installed Chrome against that server and writes
its reports and screenshots, including `original-startup.png`, to `build/`.
`python3 tools/build.py --profile` also writes `dist/engine.js.symbols` for
resolving Wasm function indices in browser CPU profiles.
Builds use compiler optimization level 2; `--optimize 1` selects level 1 with
a separate object cache for comparisons.
`--linear-fpu` builds the shifted x87 layout in a separate cache for comparisons.
`npm run test:renderer` opens normal Chrome for GPU pixel checks and writes
`build/webgpu-renderer.png`, `build/thrash-driver.png` and a JSON report. Headless Vulkan adapter
initialization is unreliable on this Chrome build; the normal browser works.

Other static hosts must send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`; `dist/_headers` provides this
configuration for hosts that support that format. The build uses a 512 MiB
shared Wasm memory initially, including the 256 MiB guest arena, and an
eight-worker native thread pool.
HTTP byte ranges improve asset loading; full-file responses also work. The
local server supports ranges. Staging copies about 531 MiB for this installation.

On this machine the read-only input is:

```text
~/wines/prefixes/nfs5/prefix/drive_c/Program Files/Electronic Arts/Need For Speed - Porsche Unleashed/nfs5.exe
```

The tested executable's SHA-256 is
`c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906`.
The differential checks require this version. Preparation also reads the matching
Verok `nfs5.dll` beside the executable (`--patch-library` selects another path).
Original executables, generated
game C, and compiled output are ignored by Git; users supply their own game.
Serving `dist/` exposes the supplied executable and staged game assets.

`src/` contains the browser host, `web/` the diagnostic UI, `tools/` the
generation/build pipeline, and `tests/` the execution checks. See
[third-party notices](THIRD_PARTY_NOTICES.md) and [progress diary](diary/).
