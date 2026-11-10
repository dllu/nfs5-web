# Native analog controls, light rotation and race stutters

The touch stick now supplies continuous 0–255 action values to the original
INPUT_poll callbacks for player one's left, right, throttle and brake bindings.
The original poller converts these into its signed steering and pedal packet,
as it does for analog hardware. Keyboard values combine with the virtual axes;
menu bindings retain their ordinary input. The stick has a 6% dead zone and
releases on pointer cancellation, lost capture, pad hiding and focus loss.

The original rotating light-sprite instruction at 00451762 multiplies the
projected pixel-coordinate sum by 1/1440 turns. Consequently, increasing output
resolution increases rotation for the same view movement. The translation now
converts the displacement from the viewport centre back to the original
projection's pixel density before this multiplication, preserving the original
640×480 centre orientation. The same path handles sun and point-light sprites.
Preparation reproduces the hook and validates its instruction address. Seventy
comparisons execute the original x86 load/add/multiply independently in Unicorn
and verify density/aspect invariance through 6K and portrait projections.

Race profiling found repeated state decoding, object spreading, uniform-array
construction and pipeline/sampler key creation. The graphics consumer now
interns immutable states with full-word collision checks and a 4096-entry FIFO.
Eviction removes one entry at a time. The renderer retains normalized state,
uniform values per logical size, and pipeline/sampler references using weak
keys. GPU texture handles still resolve against the current texture table.
Reset discards the state cache. Direct renderer callers can continue mutating
ordinary options objects; only serialized transport states are interned.

Info → Copy diagnostics includes cache hits/misses/evictions and the latest 600
submission intervals (p50/p95/p99/max and counts over 33 ms). The fixed-size
timing buffer does not allocate per frame and resets on resize/visibility
changes. These intervals describe submissions, not displayed refresh rate.

Three ten-second, warmed local 1920×1080 Farmland windows per variant, with
four moving opponents and the human car stationary, gave:

| Renderer | Frames over ~30 s | p99 range | Maximum range | Asset requests |
| --- | ---: | ---: | ---: | ---: |
| Before cache | 2376 | 18.77–18.96 ms | 34.33–46.08 ms | 0 |
| With cache | 2364 | 18.63–19.09 ms | 48.38–53.86 ms | 0 |

The cached windows reused 945,803 states with only two misses. CPU profiles
remove decodeGraphicsState/effectUniforms from the JavaScript hotspots. This
does **not** establish a frame-rate or worst-case-latency improvement: the
larger pauses persist. The cached variant overlapped preparation on another
CPU core; scene/opponent positions also vary. A separate warmed trace shows
30–60 ms intervals mainly before the first draw packet, with short RAF waits,
short draw processing and no slow queue.submit calls during those intervals.
One initial per-frame diagnostic acquired the VM lock and perturbed timing;
its larger spikes are not used as baseline evidence.

A normal Showroom → Single player → Quick race → Côte d'Azur run exposed a
second path: after moving into sunlight, each frame reads 4×4 visibility pixels.
An 18-second driving/coasting sample presented 1238 frames, with p99 18.90 ms
and maximum 64.54 ms. All five intervals over 33 ms coincided with mapAsync
waits of 24–52 ms. Reusing a staging GPU buffer in an experiment did not remove
the pauses and is not retained. Streaming music requested ten new 64 KiB
ranges over twenty seconds; CDP measured about 3 ms per request, and most long
maps had no simultaneous request. Blanket preloading of the 531 MiB
installation is not justified by these captures.

The ongoing sun-occlusion call at 00460525 now explicitly requests a completed
earlier sample through transport v9. The initial reference capture and all
ordinary framebuffer reads remain exact. Each sun has one query in flight;
polls reuse the latest completed pixels, normally one frame old. The cache is
bounded and resets with the framebuffer. This removes an unnecessary
per-frame CPU/GPU synchronization point while preserving native destinations,
pixel conversion and pointer lifetime. The wrapper falls back to the original
callback when the readrect target is not the browser driver.

The exploratory asynchronous experiment presented 1625 frames in twenty
seconds (~81/s versus ~69/s in the preceding sample), with p99 18.81 ms and
maximum 53.24 ms. Scene/time differences limit this comparison; it does not
prove a stable speedup or eliminate the remaining long intervals. Further
measurements on the affected Windows browser are needed; no Windows hardware
claim follows from this host. The packaged implementation's normal-menu race
subsequently presented 1447 frames in 18.008 s (~80.4/s), p99 18.81 ms and
maximum 46.13 ms. It launched 1440 sun queries and reused completed samples
1447 times, confirming the native call-site hook is active. Four intervals
still exceeded 33 ms. Cache/query counts in diagnostics identify the active
path without adding VM-lock acquisitions every frame.

Validation passes: npm test; hardware Chrome renderer/native-shader checks;
forced hash collision, A/B/A state reuse, reset and incremental eviction with
pixel verification; touch/browser usability; original INPUT_poll steering
across nine signed axis positions, proportional pedals, keyboard mixing and
real partial touch displacement; hidden-tab loading/racing; public launch,
diagnostics, profile creation and browser-restart persistence. The 911 GT1 with
four opponents on Auvergne loads/drives at 1280×960, 3840×2160 and 6144×3456;
the last grows shared Wasm memory to 460.8 MiB. Physical mobile devices remain
unverified. No Wine process was launched or installation modified.

Raw CPU profiles, Chrome trace, before/after windows, native analog packets,
flare comparisons and screenshots remain in ignored build/ artifacts. Delayed
query tests verify first-sample initialization, historical sample reuse, one
pending query, exact ordinary reads, reset/resize and asynchronous errors.

The final Wasm matches the tested profiled build byte for byte:
`8aec4e60438031351b85916474fd913be1c3123cdce57e70b3298a2530eb4664`.
Public revision `c0390e2bf5263acd` is deployed to pupserver.linode:/www/misc/nfs5.
