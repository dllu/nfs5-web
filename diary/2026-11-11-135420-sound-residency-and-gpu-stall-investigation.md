# Sound residency and GPU stall investigation

The supplied capture contains independent sources of long frames. Ordinary
`GameData/Sounds/track.viv` reads take 35–183 ms and repeatedly fetch pages of
the same 10,493,416-byte archive. The ordinary cache holds only eight 256 KiB
pages. These reads predate the supplied recent GPU stalls, so they do not
explain every long frame. Heap diagnostics do not indicate exhaustion.

The public startup pack now includes this complete, unchanged sound archive.
It stays resident with small assets and music metadata instead of competing
with streamed music or random effects for ordinary cache pages. Pack size is
20,876,824 bytes, 11,888,052 bytes compressed. Builder and runtime bounds are
32 MiB. This adds about 10 MiB of resident data and 8 MiB of compressed startup
download; fetching still overlaps Wasm compilation. Writable overlays retain
their existing precedence.

Framebuffer color/depth views now survive until resize instead of creating
two new WebGPU objects per render pass. Long-frame history and wait baselines
reset together with submission intervals on resize/focus/visibility changes.
Previously the supplied portrait timing window retained old 6K long frames.

## Reproduction and limits

Used Chrome hardware WebGPU on the GB10 through a separate headless Sway
compositor, with the original Alps race, four opponents, Very Far detail and
atmospheric skyboxes. No source-installation/Wine changes. Ignored scripts
and profiles remain within this checkout.

A 60-second warm 6144×3456 stationary run made zero ordinary asset requests:
3,207 presentation intervals, median 16.88 ms, p99 36.60 ms, maximum 59.24 ms. Browser
tracing shows roughly five-second periodic 27–55 ms CPU tasks on Chrome's
GPU thread (`Scheduler::RunTask`). The longest JavaScript major collections
in that trace were about 2.4 ms. These tasks remain at 1920×1080: a 30-second
trace has six 26.9–28.4 ms GPU-thread tasks. They are outside the traced Dawn
command/polling scopes; the exact browser/driver operation is not identified.
Do not call these timings proof of GPU shader execution taking that long.

The stationary Alps cockpit does not exercise the original sun readback
continuously. Additional tests inserted a single pending 4×4 probe to exercise
readbacks. Replacing the texture copy with a compute gather did not improve
the tail and was removed. Native profiling captured stripped Chrome and NVIDIA
code but did not identify the periodic task. Reusing views reduces resource
creation, but does not establish a measurable tail-latency improvement.

A fresh-profile 2713×3306 driving run with the new pack made zero ordinary
asset requests during its 30-second measured window, with no track-sound
requests even during loading. Startup preloaded data reported 20,775,087 bytes
(selected sky replacements supersede some packed files). GPU stalls remain;
this is an I/O fix, not a claim that all reported stutters are solved. Other
applications and some verification runs share this GPU, so no before/after
frame-rate claim is made. Page CDP latency emulation did not reliably delay
native-worker XHR; its configured 100 ms is not evidence of delayed I/O.

## Validation

- Hardware renderer: 169 backend checks, 288 native-driver checks, 450 ABI
  calls, 4K reads, asynchronous visibility, resize and two-frame backpressure.
  The timing regression includes a real 40 ms pause and verifies resize clears
  both histories. Updated stale mobile viewport expectations to the existing
  1244×933 fitted 4:3 mode; runtime mobile behavior is unchanged.
- Startup pack/native preload and all 85 filesystem/path checks pass. A byte
  comparison verifies the complete track archive in the generated public pack.
- Pacing, viewport/config and hardware adapter selection checks pass.
- Public browser lifecycle: autostart, original profiles, fullscreen race
  resize, skyboxes, browser restart, backups/restores and persistence pass.
  A final run records raw sound-archive requests across the complete lifecycle
  and asserts there are none.
  Shared Wasm capacity assertions allow the preload's 16 MiB growth increment.

Deployed revision `40ec3d1c78b99441` to `https://nfspu.com/`. A fresh live Chrome
hardware run confirms the 20,876,824-byte preload, 1,039 preloaded files and no
page errors. Runtime initialization reported 773 ms on this warm machine.
Live HTTPS isolation headers and the old `/nfs5/` permanent redirect pass.

Ignored artifacts: `build/stutter2-*.json`, traces/screenshots, native perf data,
`.cache/stutter2*.mjs`, and private browser/compositor profiles. The remaining
GPU-thread pauses need deeper browser/native investigation; image quality and
native sun-query behavior have not been reduced.
