# Loading latency, GPU submissions, native audio and touch controls

The Windows Firefox report contains about six GPU submissions per presented
frame, p50 24.28 ms, p99 115.72 ms and 170/600 intervals over 33 ms. The adapter
is reported as hardware; blank identifying fields do not imply software here.
Firefox 159 on this Linux host now exposes the NVIDIA GB10 with the same blank
public fields. Atomics.waitAsync and scheduler.yield are available, and the
observed timer quantum is 20 microseconds. Neither missing waitAsync nor
coarse timer precision was established as the reported cause.

## Rendering and audio

The renderer reuses identical effect-uniform blocks within a flush and avoids
redundant pipeline, vertex/index-buffer, stencil, uniform, texture and scissor
bindings within each render pass. Texture mutations, real framebuffer reads,
resizes and presentation preserve command order. Small legacy flush hints are
combined; batches with at least 256 KiB of geometry submit early so GPU work
can overlap further native scene preparation. Ignoring every hint was tried
and rejected: submissions fell from seven to one per frame, but local warmed
Chrome/Firefox throughput fell slightly. The retained threshold gives about
two submissions per frame in the Farmland fixture.

Two warmed ten-second Firefox Farmland windows at 2560×1307 with four moving
opponents and a stationary human car gave baseline 75.4/80.2 submissions of
presented frames per second, p99 18.56/18.26 ms. The retained policy gave
77.1/78.7, p99 18.44/18.42 ms. These exploratory windows do not establish a
throughput or long-tail improvement: a concurrent loading experiment and
changing scene positions limit comparison. The friend's 115 ms p99 was not
reproduced. No claim of fixed Windows/iPhone frame pacing follows from this
host; fewer API calls are a concrete overhead reduction.

The audio host previously entered the blocking VM mixer every four
milliseconds on the graphics worker. This could park rendering behind another
VM owner. Audio now uses a native 4096-frame stereo ring directly consumed by
the AudioWorklet. The thread already owning the VM refills up to 1024 frames
before releasing ownership. A host timer handles idle periods with trylock;
busy ticks return immediately. No extra native thread/stack is allocated.
Sound sample access remains protected by the VM lock; the worklet only reads
published ring entries. Startup, shutdown and invalid rates are guarded, and
the original direct mix export remains available. A native scheduling test
keeps the original compute loop busy and verifies 100 refill attempts return
without waiting (0.02 ms in the recorded run). A Firefox public launch reports
1193 native fills, 2151 skipped busy ticks and 596992 consumed PCM frames.

## Loading and memory

The public packager concatenates and deduplicates files up to 64 KiB into an
immutable SHA-256-verified pack: 1038 file entries, 8,432,660 physical bytes,
about 2.5 MiB gzip. Download begins alongside Wasm compilation. Native file
nodes borrow the pack bytes; ordinary range reads remain the fallback and
writable browser records override the pack. Writes copy and detach immutable
backing without adding startup assets to save snapshots. Larger range pages
are 256 KiB, with eight LRU pages (2 MiB total).

A controlled Chrome network test with 50 ms latency, unlimited bandwidth and
identical public game assets compared old 64 KiB ranges against the pack and
256 KiB ranges. The original profile chooser became ready in 27,241 ms versus
13,715 ms. Asset requests fell from 291 to 34; native range fetches from 290 to
32. The new runtime reports 350 resident-pack reads, 5,664,909 range bytes and
1743 ms total synchronous range wait. This includes downloading the new pack;
it does not model slow bandwidth or mobile Wasm compilation. The readiness
probe observes completed presentations rather than flushing an incomplete
frame to inspect pixels.

Wasm now has an immutable content-hash URL, preserving download/compilation
cache identity across JavaScript/CSS-only releases. Other code dependencies
retain one coherent content-derived release query. The fixed VM arena and
initial shared memory remain 256/384 MiB; the pack adds about 8 MiB rather
than preloading the entire 531 MiB installation. Touch devices default to a
1440×810 pixel budget, preserving aspect and the original minimum dimensions.
For a 2796×1290 viewport this is 1590×733. Frontend/garage output keeps monitor
density; explicit in-game resolution choices remain available. This reduces
race render-target pressure on phones but physical iPhone performance is not
verified here.

Buttons, the touch pad and canvas suppress user-select, -webkit-user-select
and -webkit-touch-callout. Diagnostic text and profile-name entry remain
selectable. A browser test holds Gas for one second, verifies that native
throttle remains held without text selection, then checks release.

Info diagnostics include loading/preload counts, range request bytes/waits,
resident reads, native audio fills/skipped busy ticks and rendering bind counts.
These are snapshots on request, not additional per-frame VM lock acquisitions.

## Validation

Passes: full npm test including native audio scheduling and immutable pack
checks; Chrome browser PCM/worklet and intro playback; renderer/native-shader
pixels and ABI, including uniform/bind reuse and touch pixel limits; mobile
input/held pedals, analog steering, pause and hidden-tab race usability.
Firefox 159 hardware public smoke passes pack reads, native audio output,
4:3 menus, hidden cursor and startup. The original 911 GT1 with four opponents
on Auvergne loads and drives using the actual public pack at 1280×960,
3840×2160 and 6144×3456; 280/274/274 driving frames over the test windows.
4K/6K grow shared Wasm memory to 460.8 MiB; 1280×960 stays at 384 MiB.

Raw reports and screenshots are ignored build/ artifacts, including
loading-comparison.json, firefox-submission-comparison.json,
firefox-threshold-comparison.json, firefox-performance-public-smoke.json and
race-loading.json. No Wine process was launched or installation modified.
The final normal-build Wasm SHA-256 is
f3086de1b91316bae708a9ae57c9f14cf4e91d18a10b10315bb719799bf87cb7.

The final packaged local public test passes direct launch, preload/native audio
diagnostics, completed seed, fresh-profile defaults, tab-close confirmation and
byte-identical profile persistence across a browser restart. Packaged revision:
8ee4754e2229ccca.
