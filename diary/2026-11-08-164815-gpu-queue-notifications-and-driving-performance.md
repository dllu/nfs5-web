# GPU queue notifications and driving performance

The graphics consumer's one-millisecond interval actually fired about every
four milliseconds in Chrome (80 samples, median 4.0 ms). Each original frame
can cross several flush/present barriers, making this delay significant.

Transport version 2 publishes complete packets before waking the consumer with
a shared-memory notification. The consumer waits asynchronously on the write
counter, releases snapshotted ring spans with a free-space notification, and
wakes the native producer when a graphics barrier completes. Native waits
release the guest machine lock; Stop and renderer failures wake them explicitly.
Bounded native waits and the JavaScript interval fallback retain compatibility
with consumers/producers lacking notifications. Busy drains yield to the event
loop after their time budget, including a MessageChannel fallback.

The full Node suite passes, including cancellation while a GPU producer is
blocked. Chrome passes 27 backend checks, 41 native-driver checks and 72 ABI
calls, covering a 4K framebuffer round trip and ring wrapping/backpressure. A
new legacy transport check verifies clear, flush, present and pixel readback
after idle. Browser checks also pass: native input/calendar/range reads,
binary-copy/mapping/registry persistence and deletion, PCM output, the original
344-frame intro and unbounded Run/Stop/restart.

Manual samples in headed Chrome on the GB10, with the original quick race at
6144x3456 and presentation pacing enabled:

- Paused: 808 presents in 5.007 seconds, 161.36 FPS; final GPU drain 0.83 ms.
- Driving with Up held: 650 presents in 8.008 seconds, 81.17 FPS; final GPU drain
  0.44 ms. Native screenshots show changed road position and the original HUD
  at roughly 45 km/h, second gear. No renderer errors occurred.

An earlier sample labelled driving still showed the pause dialog on inspection
and was discarded. These are short samples in one scene, not controlled A/B
benchmarks or proof of sustained 4K/120 gameplay. The original graphics menu
also successfully selected a 3840x2160 race mode. HUD/pause controls remain tiny
at high resolutions.

Added an optional --profile build flag to emit the Wasm symbol map for browser
CPU profiles without changing executable/data sections. Corrected the README's
stale module size: the current diagnostic Wasm is about 126 MiB. Raw local
measurements and screenshots are in ignored build/ artifacts; no original game
assets or installation files were modified.
