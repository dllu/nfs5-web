# Asynchronous Thrash flush

Inspected the installed Verok OpenGL DLL without running Wine or changing the
installation. Its SHA-256 is
`5a57e6c244ea40ea90d69cf13bd3b79144ebca0a980f1d7cb87af48197581f6f`.
`_THRASH_flushwindow@0` at 10008690 calls the batch submitter at 10008A60,
then jumps through 1000C068. The loader at 10001BE9 resolves that slot using
the strings `gl` and `Flush`. `glFinish` has a separate slot, 1000C038.

The browser producer now publishes GPU_FLUSH without waiting for a consumer
acknowledgement. The packet remains in the ordered stream and still invokes
renderer.flush(), which submits pending WebGPU work. Command payloads are
copied into the queue before publication. Queue capacity still applies
backpressure, and presentation, readback, resize and reset retain their waits.
The consumer continues acknowledging flush for compatibility with older
producers; the transport format is unchanged.

Added 26 Node graphics-transport checks with an intentionally stalled consumer.
Flush returns with its packet unconsumed; mode change stays blocked after only
the preceding flush is acknowledged. Presentation, framebuffer readback and
reset each remain pending until their own acknowledgement. Simulated readback
bytes reach the guest in the selected RGB565 format. The old build fails the
first flush check with its graphics-wait timeout; the new build passes.

Added real WebGPU coverage that calls the native draw and flush synchronously
while the JS consumer cannot run, then overwrites the source vertex colors.
Readback still sees the original queued green triangle. The renderer suite now
passes 27 backend checks, 47 native-driver checks and 76 ABI calls, plus its
legacy polling check. The full Node suite and Chrome suite pass, including
original-code differential checks, lifecycle/cancellation, persistence, audio
and a 346-frame original intro with PCM peak 0.950.

Headed Chrome, 3840x2160, presentation pacing enabled, ArrowUp held for eight
seconds per sample:

| Build/sample | Presents | Duration | FPS | GPU drain |
| --- | ---: | ---: | ---: | ---: |
| Prior synchronous flush | 650 | 8.008 s | 81.17 | 0.90 ms |
| Asynchronous flush | 650 | 8.006 s | 81.19 | 0.39 ms |
| Asynchronous flush after race restart | 683 | 8.006 s | 85.31 | 1.69 ms |

No renderer errors occurred. A separate unpaced coasting sample reached
82.69 FPS. Workloads vary with scene/opponents: the first two samples had about
321/319 draws per frame, whereas the restart sample had about 229. These
measurements do not establish a gameplay FPS gain. The 4K/120 target remains
unmet. Pause, restart and keyboard acceleration still work; the original HUD
remains small at native 4K.

A five-second CPU profile has no flush-acknowledgement wait chain. Main guest-worker
futex samples total about 0.94 s, including about 0.75 s under presentation.
Other CPU work remains substantial. Samples in waits represent blocked wall
time, not active CPU time. The raw profile, matching symbol map, measurements,
native-resolution screenshot and baseline engine are retained in ignored build/
artifacts. The production module remains about 84 MiB. README records the
current semantics, test coverage and observed performance. The normal production
build has the same Wasm SHA-256 as the tested profiled build:
`ef90a6be48aae91613377bd2e0c9592c9cf4279652cbfe3867b5b9387bff95d8`.
