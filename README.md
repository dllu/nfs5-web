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
  then starts the original worker (`0x0055F4F0`). About 6,100 function entries
  execute through keyboard/mouse setup before `KERNEL32!GetFullPathNameA`.
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
- 68 independent original-x86/Unicorn versus Wasm comparisons pass across four
  routines: two range-copy loops, an object initializer, and an x87 dot product.
- 31 Windows-service checks cover text conversion, buffer errors, dynamic
  imports, the game's 128 MiB allocation/release probe, and realloc preservation.
- 54 synchronization checks cover ownership, event reset, atomic wait-all,
  semaphore limits, duplicate handles and stale-handle rejection.
- 24 thread checks cover suspended startup, thread-local state, saved registers,
  completion, event signaling between workers and finite wait timeouts.
- 27 timer checks cover deadlines, periodic events, cancellation and pulse
  delivery, including wait-all behavior when another event is unavailable.
- 45 DirectInput checks cover COM calls, original callbacks, device state,
  buffered events, mouse deltas and focus loss. Chrome additionally verifies
  physical key events through the browser adapter.

Rendering, asset access, audio, gameplay, and persistent save games
remain unimplemented. The 4K/120 Hz target is unmeasured. The current diagnostic
Wasm module is about 72 MiB and retains tracing and execution limits. The x87
helpers use double precision; full floating-point and binary compatibility are
unverified.

## Build and inspect locally

Prerequisites: Git, Python 3.10+ with venv, Node 18+, and npm. All downloaded tools,
temporary files, build outputs, and browser profiles stay in this checkout.

```sh
python3 tools/bootstrap.py
.venv/bin/python tools/prepare.py "/path/to/your/installation/nfs5.exe"
npm run build
npm test
npm run serve
```

Open <http://127.0.0.1:8000> and select **Run original startup**. The page reports
the next unsupported dependency and a trace of executed original functions.
`npm run test:browser` tests installed Chrome against that server and writes
its report and screenshot to `build/`.

Other static hosts must send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`; `dist/_headers` provides this
configuration for hosts that support that format. The build uses a 512 MiB
shared Wasm memory initially, including the 256 MiB guest arena, and an
eight-worker native thread pool.

On this machine the read-only input is:

```text
~/wines/prefixes/nfs5/prefix/drive_c/Program Files/Electronic Arts/Need For Speed - Porsche Unleashed/nfs5.exe
```

The tested executable's SHA-256 is
`c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906`.
The differential checks require this version. Original executables, generated
game C, and compiled output are ignored by Git; users supply their own game.
Serving `dist/` currently serves a local copy of the executable as well.

`src/` contains the browser host, `web/` the diagnostic UI, `tools/` the
generation/build pipeline, and `tests/` the execution checks. See
[third-party notices](THIRD_PARTY_NOTICES.md) and [progress diary](diary/).
