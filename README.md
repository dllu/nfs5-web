# NFS Porsche Unleashed on the web

Work in progress: the original PC executable is statically translated from x86
to C with pcrecomp, then compiled to WebAssembly with Emscripten. The browser
executes original startup code, plays the intro with game audio, and renders
the 3D frontend, main menu and profile chooser. Menu interaction still needs work.
**The game is not playable yet.**

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
  Node startup has no GPU attached.
- The opening-movie part of `nfs5.ini`'s `NoMovies` setting is honored through
  the supplied patch's original jump point in the static translation.
  Development runs can force playback with `loadRuntime({intro:true})`.
- Mutex/event/semaphore handles, recursive ownership, named references, and
  blocking waits are implemented. Native Wasm workers have separate CPU/FPU
  state, 4 MiB guest stacks, TLS and LastError; a lock serializes the lifted
  register file. Up to seven guest workers can run alongside the primary thread.
- Browser startup runs off the UI thread. The static server supplies the
  cross-origin isolation headers required for shared Wasm memory.
- Multimedia timers share one sleeping dispatcher and execute the original
  five-argument callback, including its one-shot rescheduling. Event timers,
  periodic dispatch, synchronous cancellation and pulse waits are implemented.
  Guest tick counters, input/message timestamps and performance counters use
  one monotonic origin shared by native workers.
- DirectInput keyboard/mouse devices execute original enumeration callbacks and
  expose immediate/buffered input, event notifications, relative mouse movement,
  and focus loss. Browser key events reach the Wasm device through the runner.
- DOS paths, case-insensitive files/directories, file sharing, duplicate handles,
  reads/seeks, enumeration and a 64 MiB memory write overlay are implemented.
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
  screen-space projection, perspective UVs, vertex colors, depth, blending,
  alpha tests, clipping, fog and texture-update ordering. A 41-export Thrash
  replacement connects guest driver calls to an OffscreenCanvas through a
  bounded shared-memory queue, with chunked texture uploads, framebuffer
  reads/writes and mode changes. The original video decoder presents through
  framebuffer lock/unlock. The frontend submits original geometry and textures.
  Multitexture, mipmap and broader 3D scene fidelity remain unverified.

Validation includes 68 original-x86/Unicorn versus Wasm comparisons across four
routines, plus 85 Windows-service, 38 virtual-memory, 54 synchronization,
24 thread, 27 timer, 45 DirectInput, 85 filesystem/path, 86 mapping,
54 DirectSound, 31 registry, 98 window/desktop and 78 Thrash loader/ABI calls,
12 lifecycle checks and 10 startup-configuration checks.
Chrome verifies original startup,
physical key events, focus loss, native-worker HTTP range reads, and exact binary
file/deletion, mapped-file writeback and registry persistence across fresh pages
and Wasm instances. A known PCM
signal reaches the running browser audio graph with its expected amplitude.
An additional 15-second original-code run verifies advancing video, visible
pixels, timer callbacks and nonzero game PCM.
Chrome also verifies unbounded Run game, cooperative Stop and a fresh restart.
27 WebGPU pixel/batching checks pass on the GB10, including 3840x2160 output and
an OffscreenCanvas rendered in a dedicated Worker. Another 41 checks exercise
the native Thrash bridge, including a 4K framebuffer round trip and command-ring
wrapping under texture-upload backpressure. These do not measure game FPS.

The frontend and menu/profile controls render, but menu navigation and racing
are not validated. The game's save/load flows remain untested. Custom portrait conversion
is unavailable; the original caller uses its optional-converter failure path.
Other native-patch settings are not fully ported. Window APIs and
text input cover a limited subset; hooks and full keyboard-layout handling are
unsupported. An abrupt close can lose
changes since the last checkpoint.
The 4K/120 Hz target is unmeasured. The current diagnostic
Wasm module is about 72 MiB and retains tracing and optional execution limits. The x87
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
The differential checks require this version. Original executables, generated
game C, and compiled output are ignored by Git; users supply their own game.
Serving `dist/` exposes the supplied executable and staged game assets.

`src/` contains the browser host, `web/` the diagnostic UI, `tools/` the
generation/build pipeline, and `tests/` the execution checks. See
[third-party notices](THIRD_PARTY_NOTICES.md) and [progress diary](diary/).
