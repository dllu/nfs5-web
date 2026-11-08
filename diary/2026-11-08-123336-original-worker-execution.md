# Original guest worker executes in Chrome

Recompiled the translated engine with Emscripten pthread support. The browser
loads the engine in a dedicated worker, then runs original startup on a native
Wasm pthread, leaving the application worker's JavaScript event loop available
to manage the native worker pool. The page's UI thread remains independent.
Added a local static server and `_headers` configuration for COOP/COEP isolation.

Each guest worker gets a native C call stack, a 4 MiB guest stack, a TIB/TLS area,
LastError and a saved CPU/FPU/flag/segment register file. The machine lock transfers
that global register file between workers at Windows calls, blocking waits,
sleeps and loop backedges. Critical sections now track owners and recursion.
CreateThread supports suspended startup, ResumeThread releases it, and native
completion makes the corresponding thread object signaled. GetExitCodeThread is
available through dynamic API lookup. Errors retain their originating guest
thread and import; fatal startup stops cancel and join background workers.

The original `0x0055F4F0` worker executes and clears the parent's parameter-copy
handshake. Original startup reaches `WINMM!timeSetEvent`, caller `0x00564EB0`,
after approximately 5,964–5,967 function entries, depending on scheduling. The
last call requests a one-shot callback after 6 ms. Multimedia timer callbacks
are the next missing service.

Validation:

- Node and Chrome 157 confirm both original WinMain and the original worker entry.
- All 68 x86/Unicorn versus Wasm comparisons, 31 service calls and 54
  synchronization calls pass with shared memory and native pthreads enabled.
- 24 new thread calls verify suspended startup, isolated TLS and LastError,
  parent integer/x87 registers across worker switches, exit codes, a worker
  signaling an event awaited by the parent, and a real finite wait timeout.
- The test worker entry for TLS uses the actual one-argument stdcall import
  bridge; the full startup check separately exercises the original game worker.

Current limits: seven guest workers plus the primary thread, a serialized guest
register file, no forced thread termination or full exception handling, and no
multimedia timer callbacks yet. Rendering, asset I/O, audio, gameplay input,
local save persistence and target frame-rate verification remain open.

Reference: [Emscripten pthread support](https://emscripten.org/docs/porting/pthreads.html).
The original Wine prefix was only read; all changes and generated artifacts stay
inside the project.
