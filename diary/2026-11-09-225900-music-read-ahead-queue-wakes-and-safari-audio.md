# Music range stalls, queue notifications and iPhone audio

A normal Showroom → Single player → Quick race → Côte d'Azur run at 1920×1080
identified five sequential reads of GameData/Music/zzzymus.viv over 45 seconds.
With 100 ms network latency each request took 103–105 ms and coincided with a
115–122 ms presentation interval. Synchronous file reads hold the guest VM lock,
so this blocks simulation/audio as well as the thread performing the read.
Other 40–57 ms intervals correlated with asynchronous GPU map completions.
Those are a separate remaining source of long frames.

Music now has four independent 256 KiB shared pages. A JavaScript worker fetches
at most two ranges concurrently, keeping up to three future ranges ready after
the native reader's latest page. Native code claims READY pages atomically
before reading metadata/data; the worker cannot evict claimed pages. This
bypasses synchronous HTTP for ready music pages without changing the general
filesystem's VM locking or handle/cache ownership. New seeks and unavailable
pages retain the normal exact read path. Asset replacement/writes detach the
stream, invalid HTTP ranges disable read-ahead, and disposal terminates its
worker. The cache occupies 1 MiB in initial shared memory; it does not preload
the 117 MiB music archive or add another native worker stack. Node runs retain
the ordinary file provider rather than using Emscripten's global Worker shim.

Graphics producers previously issued a futex wake for every command, and the
consumer notified free space after every packet. Transport v10 publishes first,
then wakes only if the consumer could have parked at the previous write index.
A producer registers its queue-space waiter count before rechecking capacity;
consumer space notifications are conditional on that count. Multiple waiting
producers, Stop/failure wakeups, packet order and barriers are preserved. The
JS consumer continues supporting protocols 1–9. In a 45-second window it sent
360,941 producer notifications for 1,027,775 packets, about 65% fewer wake calls.
This is a measured call-count reduction, not a claim of a corresponding FPS gain.

The matched isolated-session race windows with 100 ms network latency gave:

| Metric | Baseline | Read-ahead and queue changes |
| --- | ---: | ---: |
| Presented intervals | 2566 | 2600 |
| Median | 16.97 ms | 17.13 ms |
| p99 | 24.63 ms | 24.43 ms |
| Maximum | 121.08 ms | 60.82 ms |
| Intervals over 33 ms | 12 | 7 |
| Synchronous range reads | 4 | 0 |
| Synchronous network wait | 423.13 ms | 0 ms |

The new window served three music pages from read-ahead, with three further
background requests completing in 103–104 ms and no read-ahead failures.
Music selection and scene/opponent positions vary between runs; ordinary
throughput and worst-case latency comparisons are exploratory. The direct
request/frame correlation and zero synchronous wait establish the particular
network stall removed. Remaining GPU/OS stalls are not claimed fixed.

The user also reports no iPhone audio and confirms Silent Mode was enabled.
Safari treats ordinary Web Audio as ambient, obeying the mute switch:
https://bugs.webkit.org/show_bug.cgi?id=252746#c2
The host now feature-detects navigator.audioSession and requests playback before
creating AudioContext, restoring the previous type on close/failure. Browsers
without this API retain their audio path. Info now merges real browser context
state/sample rate/session type with native refill counters and worklet peak.
This separates a suspended/muted route from a zero PCM signal. Policy/resume/
cleanup/fallback tests pass; audible output on the physical iPhone needs retest.

After the user's request to keep new browser windows off their desktop, the
interactive profiling Chrome was closed. Subsequent checks use a dedicated
headless Sway, XDG_RUNTIME_DIR within this checkout, WLR_BACKENDS=headless,
WLR_RENDERER=gles2 and WLR_RENDER_DRM_DEVICE=/dev/dri/renderD128. A private Chrome
wrapper selects that Wayland socket and --mute-audio. The pixman compositor
and ordinary headless Chrome did not reliably expose this GPU; the GLES2
headless Sway does expose hardware NVIDIA WebGPU. No user desktop compositor
or existing development server was stopped. Timing in this environment should
not be compared directly with earlier desktop-monitor benchmark rates.

Passes: full npm test with new read-ahead/native page and audio policy checks;
92 graphics-transport checks including idle/nonempty publication and explicit
full-queue parking/wake; isolated hardware renderer/native shader comparisons;
browser PCM/intro playback, profile bytes and frontend lifecycle. Reports are
ignored build/perf-pass-*.json/log files. Further GPU-readback sampling experiments
are separate from this verified implementation. No Wine process was launched.
