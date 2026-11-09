# Graphics deadlines and VM handoff measurements

The graphics producer checked the host clock for every packet even when
run-until-Stop had an infinite deadline. It now skips that clock read in
unbounded runs, as the function/loop hooks already do. Renderer attachment,
failure checks, queue ordering and Stop behavior remain active. Finite runs
still check their graphics deadline.

Added a stalled-consumer timeout case to the transport suite: a finite mode
change returns its graphics-wait error without an acknowledgement. There are
now 27 transport checks. Expanded the thread suite to 70 calls. Seven workers
execute original 005292D0 searches over a cyclic list, remaining active before
the host atomically publishes the sought value. All seven then complete with
their correct node return value. Parent TLS and x87 state survive the switches.
This also passes on the prior engine.

Investigated the VM yield's 50-microsecond usleep. The local Emscripten SDK
busy-spins for sleeps below 0.1 ms. The preceding game profile attributed about
0.75 s of a five-second main-worker sample to clock reads, mainly under that
yield. Tested two bounded futex alternatives using the existing mutex and CPU
save/restore: notification on another owner's acquisition, and notification
on another owner's release. Both retain a 50-microsecond timeout and pass
the compute-worker checks. Neither scheduler change is retained.

Controlled Node microbenchmarks run original 005B0730 transforms with 4096
vertices per call, 100 warmup calls, then five batches of 300 calls. One or
seven competing original searches remain busy during the measurement. Median
primary-thread transform rates, in million vertices/second:

| Scheduler | One contender | Seven contenders |
| --- | ---: | ---: |
| Existing mutex/yield | 9.21 | 8.07 |
| Acquisition notification | 12.08 | 3.53 |
| Release notification | 8.81 | 4.54 |

Every output/clip hash matches
`eeab83a27d19495a7f0ddf895585a26f4da08db942c9da0604dd947b8c1b7ebb`.
These rates measure the primary thread's share; competing searches do not
finish, so changes in fairness affect this benchmark. They do not establish
total guest throughput or gameplay performance. Shorter, less warmed samples
were noisy; the table uses the longer runs.

Headed Chrome, 3840x2160, pacing disabled, eight seconds per sample:

| Scheduler | Acceleration FPS | Draws/present | Coasting FPS | Draws/present |
| --- | ---: | ---: | ---: | ---: |
| Existing mutex/yield | 84.93 | 209.5 | 83.43 | 161.5 |
| Acquisition notification | 79.21 | 200.6 | 76.43 | 208.4 |
| Release notification | 84.56 | 253.2 | 83.95 | 141.5 |

No renderer errors occurred. The baseline acceleration sample overlapped
separate WebGPU validation for part of its duration; the coasting sample began
after that validation finished. Scene/opponent positions and workloads also
vary. These are exploratory comparisons, not controlled proof of FPS changes.
There is no reliable gameplay gain supporting either more complex scheduler.
The final code therefore retains the existing mutex/yield behavior.

Both experimental profiles remove the yield's busy clock-spin samples but
show more time in original game code, including the main routine and
004B0FA0/004B0D70/005366E0. Original race-loop code at 0041540E..00415D1D
contains repeated pumping, guest-counter checks and rendering. These are
candidates for further investigation; the profiles lose some caller detail
through inlining. Wait samples represent blocked wall time, not active CPU.
Static inspection identifies writes to guest counters 6559EC/6559F8 at
004A46A9/004A46AE in original callback 004A45D0. Counter 5E99B8 increments
at 00413750. Their interaction with the race loop remains to be measured.

Raw profiles, matching symbol maps, comparison engines, screenshots and
benchmark JSON remain in ignored build/ artifacts. The final Node suite and
WebGPU suite pass, including 201 original-code comparisons, 24,000 x87 model
transitions, 60 exact integer-state returns, the expanded thread/transport
checks and existing lifecycle checks. The 4K/120 gameplay target remains unmet.
Chrome also passes calendar/input/range reads, persistence/deletion, PCM,
the 321-frame original intro with peak 0.950 and Run/Stop/restart.
The production Wasm is 87,935,843 bytes, with the same SHA-256 as the tested
profiled build:
`724c1d2fcad115bdb33831e4803f591eb0a9221ff980ce8698cd3c7d3701bea1`.

Final production check with the retained scheduler, presentation pacing enabled
and ArrowUp held at 3840x2160: 690 presents in 8.00693 s, or 86.18 FPS. The
renderer averaged 210.8 draws per present and drained in 0.51 ms, with no
errors. Screenshot and raw counters are in build/gpu-deadline-driving.*.
This short sample does not establish a speedup. README records the latest
measurement and the expanded coverage. The original Wine installation was
not modified.
