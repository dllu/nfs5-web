# Original WinMain reached in the browser

The translated executable now completes its CRT setup and enters the original
`WinMain` at `0x004B6710`. Both Node and installed Chrome 157.0.8103.38 record
2,099 original function entries, stopping at `KERNEL32!CreateMutexA` from
`0x005655F0`. The recent trace includes the CRT-to-WinMain transfer and then
`0x004B6A50`, `0x0059ED40`, `0x0059ED90`, and `0x004A5C30`.

Implemented the CRT's CP1252 classification, case conversion and wide/narrow
conversion, with the Windows 95 failures that select its ANSI locale path.
The character tables/helpers are adapted from the pinned pcrecomp runtime with
attribution. Dynamic lookup now distinguishes modules and resolves supported
functions by module and name; the optional `IsProcessorFeaturePresent` lookup
returns `ERROR_PROC_NOT_FOUND` and the original CRT executes its fallback.

Game initialization probes a 128 MiB VirtualAlloc reservation, then immediately
releases it. Expanded guest memory to 256 MiB and implemented tracked allocation
spans, release/reuse, heap size/free/realloc and reservation-bounded commits.
Guest stacks remain separate from the heap. This is still a partial Windows
memory model, without per-page access protection or full process/thread support.

Verification:

- Build and both original-startup checks pass; tests explicitly require original
  WinMain in the trace. An independent first-entry record survives trace-ring
  wraparound.
- All 68 x86/Unicorn-versus-Wasm comparisons still pass, using the expanded guest
  address space in both runtimes.
- 31 service calls check every CP1252 code point against Node's independent
  decoder, case mapping, classification, short-buffer failures, Win95 locale
  fallback, module aliasing, dynamic dispatch and missing-symbol errors. Memory
  checks repeat the 128 MiB allocation/release probe and verify realloc preserves
  bytes, zeroes growth when requested and rejects freeing the old pointer.
- Chrome produces the same stop as Node and writes the current diagnostic
  screenshot/report under ignored `build/`.

Next dependency: synchronization objects beginning with CreateMutexA, followed
by the game services reached from WinMain. The game still has no browser
renderer, audio, playable input or persistent saves; performance targets remain
unmeasured. The Wine installation remains untouched.
