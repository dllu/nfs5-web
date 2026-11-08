# Original intro video and game audio run in Chrome

Implemented window classes and generation-checked window handles, original
creation/activation callbacks, client/frame geometry, child coordinates,
painting/DC lifetimes, filtered thread-owned message queues, quit messages,
window destruction and browser keyboard/mouse/focus delivery. Native message
waits release the VM lock and observe the diagnostic deadline. DOM callbacks
only queue messages; guest callbacks execute on the window's owning thread.
Hook installation reports unsupported rather than advertising a working hook.

Added memory status bounded to the guest arena and reusable heap spans. Startup
then reached the original video/audio path, but remained black and silent.
Investigation found that Emscripten's clock includes `performance.timeOrigin`.
Its direct double-to-uint32 conversion saturated at `0xFFFFFFFF` in Wasm, so the
game's elapsed-time comparisons never expired and its timer delays grew.
Guest ticks and performance counters now share an elapsed monotonic origin;
tick conversion goes through uint64_t before the defined 32-bit wrap. Input and
window-message timestamps use the same clock. Added per-buffer audio diagnostics
to distinguish playing PCM, primary buffers and cursor progress.

A 15-second Chrome 157 hardware-WebGPU run now executes the original decoder,
presents 331 frames, captures 223,236 nonblack pixels, and produces nonzero game
PCM (recorded peak about 0.95). The retained screenshot shows the Porsche intro
cinematic. This is movie playback, not a gameplay or 4K/120 Hz result. The old
two-million-function cap is removed; wall-clock limits remain. The diagnostic
page retains a bitmap of its final GPU frame after cleanup.

Validation includes 78 Windows-service calls (memory reuse and main/native-thread
clocks) and 98 window/desktop calls (original WndProc, paint validation, child
coordinates, filtering, per-thread quit isolation, key metadata/text, input
wakeup, cancellation and stale handles). Existing differential, synchronization,
thread, timer, input, filesystem, PCM, registry and Thrash suites pass. Chrome
integration covers startup, input, range reads, persistence, synthetic PCM and
the original intro; WebGPU backend/native-driver pixel tests also pass. Reports
and proprietary screenshots remain ignored under `build/`.

Creation and queue semantics were checked against Microsoft's
[CreateWindow documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createwindowa),
[window procedure documentation](https://learn.microsoft.com/en-us/windows/win32/winmsg/using-window-procedures),
and [WM_QUIT documentation](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-quit).
Menus, racing, save flows and broader window/graphics fidelity still need work.
