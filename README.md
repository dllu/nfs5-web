# NFS Porsche Unleashed on the web

Work in progress: the original PC executable is statically translated from x86
to C with pcrecomp, then compiled to WebAssembly with Emscripten. The browser
executes original startup code. **The game is not playable yet.**

Current implementation:

- A pinned lifter, checkout-local compiler/dependencies, reproducible generation,
  and a static browser diagnostic page.
- 10,781 recovered function candidates from Verok 1.06 `nfs5.exe`, with original
  data sections, import dispatch, x87 helpers, a guest stack/TIB, CP1252 locale
  services, dynamic API lookup, and a tracked heap in a 256 MiB guest arena.
  Recovery includes overlapping instruction ranges;
  these counts do not establish complete code coverage.
- Startup reaches original `WinMain` (`0x004B6710`) in Chrome 157 and Node,
  then starts the original worker (`0x0055F4F0`). About 430,000 function entries
  execute through input, file, audio and graphics-configuration setup before
  loading `drivers\opengl3z`, the next rendering dependency.
- Mutex/event/semaphore handles, recursive ownership, named references, and
  blocking waits are implemented. Native Wasm workers have separate CPU/FPU
  state, 4 MiB guest stacks, TLS and LastError; a lock serializes the lifted
  register file. Up to seven guest workers can run alongside the primary thread.
- Browser startup runs off the UI thread. The static server supplies the
  cross-origin isolation headers required for shared Wasm memory.
- Multimedia timers share one sleeping dispatcher and execute the original
  five-argument callback, including its one-shot rescheduling. Event timers,
  periodic dispatch, synchronous cancellation and pulse waits are implemented.
- DirectInput keyboard/mouse devices execute original enumeration callbacks and
  expose immediate/buffered input, event notifications, relative mouse movement,
  and focus loss. Browser key events reach the Wasm device through the runner.
- DOS paths, case-insensitive files/directories, file sharing, duplicate handles,
  reads/seeks, enumeration and a 64 MiB memory write overlay are implemented.
  Staged assets load on demand through a shared 512 KiB range cache; Chrome and
  Node read the original startup data. Browser file changes persist in IndexedDB
  per origin/executable, checkpointing every second and when startup stops.
- DirectSound PCM buffers support locking, looping, playback cursors, shared
  duplicates, volume/pan, 8/16-bit mono/stereo and linear resampling. A shared
  stereo ring feeds an AudioWorklet; its real-time callback never takes a VM lock.
- A virtual desktop exposes viewport geometry, device contexts and color depth.
  Application registry keys retain the game's install-name fallback, typed
  values, access rights and browser-local persistence. Process environment
  snapshots support UTF-16 and CP437/OEM byte blocks.
- A WebGPU backend batches geometry and effect uploads, preserving Thrash
  screen-space projection, perspective UVs, vertex colors, depth, blending,
  alpha tests, clipping, fog and texture-update ordering. It is tested with
  synthetic geometry and **is not connected to the game driver yet**.

Validation includes 68 original-x86/Unicorn versus Wasm comparisons across four
routines, plus 68 Windows-service, 54 synchronization, 24 thread, 27 timer,
45 DirectInput, 85 filesystem/path, 54 DirectSound, 31 registry and 31 desktop calls.
Chrome verifies original startup,
physical key events, focus loss, native-worker HTTP range reads, and exact binary
file/deletion and registry persistence across fresh pages and Wasm instances. A known PCM
signal reaches the running browser audio graph with its expected amplitude.
27 WebGPU pixel/batching checks pass on the GB10, including 3840x2160 output and
an OffscreenCanvas rendered in a dedicated Worker. These do not measure game FPS.

The Thrash driver bridge, window/message handling and gameplay remain unimplemented; the
game's sound playback and save/load flows are untested. An abrupt close can lose
changes since the last checkpoint.
The 4K/120 Hz target is unmeasured. The current diagnostic
Wasm module is about 72 MiB and retains tracing and execution limits. The x87
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

Open <http://127.0.0.1:8000> and select **Run original startup**. The page reports
the next unsupported dependency and a trace of executed original functions.
`npm run test:browser` tests installed Chrome against that server and writes
its report and screenshot to `build/`.
`npm run test:renderer` opens normal Chrome for GPU pixel checks and writes
`build/webgpu-renderer.png` and its JSON report. Headless Vulkan adapter
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
