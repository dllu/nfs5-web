# Race stutters, music caching and background pacing

User reports: rare 66–160 ms race submission intervals after 1–3 minutes;
background hangs; native-density menus compete with other applications.
The supplied statistics showed continuing asset requests, occasional 456 ms
ordinary reads and music read-ahead misses.

## Findings

The baseline stationary quick-race capture ran for three minutes with 100 ms
artificial HTTP latency. All 12 requests during the measurement were music
ranges; there were zero ordinary file-cache misses and no model, texture or
sound-effect requests. This is evidence for that exercised scene, not a proof
that every track event is already resident. Native fallback reads previously
held the shared VM mutex across synchronous HTTP, allowing any cold music or
sound read to stop otherwise independent game workers.

The foreground pacer waited indefinitely for worker requestAnimationFrame.
An obscured window can stop these callbacks without the expected visibility
transition. Menus also redrew at the full display refresh, including their
native-density color/depth targets.

## Implementation

- Immutable downloads stage in a private allocation with the VM unlocked.
  Reacquisition validates a source generation before publishing bytes or using
  a cache victim. File objects retain a reference during I/O and serialize
  shared offsets, including duplicated handles. The write overlay remains
  separate. A source replaced during a download fails rather than publishing
  stale bytes.
- The public startup pack pins the music directory and every song's 64 KiB
  prefix / 4 KiB tail: 57 ranges. The pack is 10,383,408 bytes, 3,787,627 bytes
  gzip, versus the previous roughly 8 MiB pack. Every pinned byte was checked
  against the original archive. Small metadata probes do not drive read-ahead.
- Music has a fixed **12 MiB** / 48-page cache. It keeps complete current and
  directory-successor songs, combining up to four pages in each 1 MiB request,
  with at most two requests in flight. The largest adjacent pair in this game's
  directory needs 46 pages. The complete 112 MiB archive is not loaded into RAM.
  Future-song prefetch can still occur during play; warmed songs need no HTTP.
- Graphics pacing observes both focus and visibility. Menus are capped near
  60 Hz and inactive windows use an independent 30 Hz worker clock. A 100 ms
  watchdog prevents a missing animation callback from blocking forever.
  Hidden frames keep rendering offscreen, without acquiring a compositor
  surface. Focus changes also reset the short timing sample.
- GPU readbacks reuse at most four buffers of at most 64 KiB each. Large
  screenshot buffers are released after each read. Ordinary/reference reads
  remain exact and the existing sun-query cadence is retained.
- Diagnostics keep the last 32 ordinary reads (path, wall time, duration,
  offset, length, caller and guest thread), plus the last 32 foreground long
  frames with GPU and completed-readback wait measurements. Readback allocation
  counts and animation watchdog/background-frame counters are included.
- Wasm growth uses a 16 MiB linear step instead of percentage-based headroom.
  The four-opponent race now uses 400 MiB at 1280×960, about 420 MiB at 4K and
  about 453 MiB at 6K. This avoids the 461 MiB allocation seen at low resolution
  with the initial larger-cache experiment. Initial allocation stays 384 MiB.

## Verification

`npm test` passed after the I/O locking changes. After the final cache size and
memory-growth policy, startup-pack/range, complete-song, filesystem and memory
checks passed again. The song fixture exercises 46 resident pages and verifies
that advancing within the warmed song causes no additional HTTP. Existing
page-claim eviction, tail, malformed-response and fallback tests remain.

A real-browser I/O test holds HTTP responses for 600 ms. Host VM clients return
immediately while the read is pending; replacing the source mid-read rejects
stale data and preserves the destination. This covers the concurrency hazard
introduced by releasing the VM, rather than just measuring download speed.

Hardware Chrome checks use the private GLES2 headless Sway output, muted audio,
and profiles/caches inside the checkout. No desktop browser window or Wine run
was used. Rendering passed 167 backend checks, 287 native-driver checks and
450 ABI calls, plus native shader fog/geometry/gamma comparisons. Repeated small
readbacks use fresh pixels without new GPU buffer allocations.

A raw-CDP test leaves a real race hidden for **65 seconds**: native frame count
advanced from 204 to 2001 while canvas submissions stayed at 186. The bounded
queue remained at at most two pending frames. Loading also progressed hidden;
Pause/resume and focus/input release checks passed. The race fixture's present
wrapper was corrected to forward visibility arguments; otherwise it bypassed
the behavior under test.

GT1/Auvergne with four opponents passed at 1280×960, 3840×2160 and 6144×3456,
including real Wasm growth and driving after loading. Touch controls and the
packaged page passed. The public check covers menu pacing, direct launch,
profiles, saved preferences and browser-restart persistence.

## Performance limits

A four-minute stationary race sample with the initial 16 MiB song-cache
prototype warmed made **zero
network requests**, including music, and zero ordinary range reads. Its median
submission interval was 17.01 ms, p99 24.25 ms, maximum 84.27 ms, with 29 intervals
over 33 ms. The three-minute baseline was 16.93 / 24.44 / 109.29 ms, with 26
intervals over 33 ms. These sequential, unequal-duration samples share a machine
with other activity and some CPU regression checks; they do not establish a
controlled percentage improvement. The long-frame records correlate remaining
outliers with GPU-completion waits, not file downloads. Some stalls remain. The final 12 MiB cache covers the same complete current/next
song pairs (maximum 46 pages); its full-window behavior and native paths were
rechecked after resizing.

A 30 Hz sun-query experiment reduced requests but did not improve tail-frame
counts, so it was reverted. The retained change reuses buffers at the original
cadence. Audio was muted in the private test browser; its underrun measurements
are not an audible iPhone/desktop sound-quality validation.

Ignored reports: `build/stutter-*-long.json`, `build/io-concurrency.json`,
`build/race-usability.json`, `build/race-loading.json`, renderer/public reports
and `build/stutter-*.log`.

Deployed release `7d8af038c795c336` to `pupserver.linode:/www/misc/nfs5`.
Wasm SHA-256:
`719693f89d37370ceed0219f8c76df68dd03d731b4fd91a1578e39ea1a30fd8c`.
Live private-browser smoke verification passed: cross-origin isolation,
hardware autostart, 12 MiB cache, recent I/O/long-frame diagnostics, pacing
counters and live detail presets. The original development server and desktop
compositor remain running.
