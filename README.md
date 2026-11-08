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
  recording 5,944 function entries before `KERNEL32!CreateThread` in timer setup.
- Mutex/event/semaphore handles, recursive ownership, named references, and
  nonblocking waits are implemented for the serialized guest CPU. Blocking
  synchronization and guest worker execution remain to be implemented.
- 68 independent original-x86/Unicorn versus Wasm comparisons pass across four
  routines: two range-copy loops, an object initializer, and an x87 dot product.
- 31 Windows-service checks cover text conversion, buffer errors, dynamic
  imports, the game's 128 MiB allocation/release probe, and realloc preservation.
- 54 synchronization checks cover ownership, event reset, atomic wait-all,
  semaphore limits, duplicate handles and stale-handle rejection.

Rendering, asset access, audio, keyboard gameplay, and persistent save games
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
