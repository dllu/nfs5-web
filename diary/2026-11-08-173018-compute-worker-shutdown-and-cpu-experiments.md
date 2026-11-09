# Compute-worker shutdown and CPU experiments

Fixed a reproducible VM shutdown hang. stop_guest_workers acquired the machine
mutex without increasing machine_waiters. An original worker that stayed in
guest code saw no contender at its loop yields and kept the lock indefinitely,
preventing shutdown from setting its cancellation flag. All machine-lock
acquisition now uses the same waiter accounting, including shutdown's path
that does not load/save a guest CPU. Scheduling and the existing mutex remain
otherwise unchanged.

The regression subprocess starts original list-search routine 005292D0 with a
cyclic non-sentinel node, confirms that it entered guest code, then disposes
the runtime. With the baseline engine, it prints the pre-disposal marker and
hangs until an eight-second external timeout kills it. The fixed engine
completes disposal. The permanent lifecycle check runs that fixture in a
subprocess with a timeout so a regression cannot hang the test suite.

Additional checks exercise cancellation in original compute-only routine
00580B70, normal primary completion while another original worker computes,
and all seven guest workers contending while sleeping before one wait-all.
Parent TLS and x87 state survive the contention. There are now 40 thread calls
and 17 lifecycle checks. Expanded independent Unicorn comparisons from 68 to
165 cases across five routines: original 005B0100 copies test every destination
alignment, 8/32/128-byte block boundaries, large exact integer payloads and
overlapping source/destination ordering. These pass on both baseline and
experimental builds.

Investigated two CPU changes before choosing the final implementation. Neither
is retained:

- Local integer registers with publication at all function exits and the
  pinned runtime's call/yield synchronization passed the execution suites, but
  an eight-second 4K driving sample with presentation pacing disabled averaged
  84.94 FPS versus 85.29 FPS for global registers. This did not establish a gain.
- FIFO ticket ownership removed the short busy-spinning yield sleeps and
  passed compatibility checks, but the equivalent unpaced race sample fell
  to 63.94 FPS. A separate profiled sample averaged 63.76 FPS. The final fix
  retains the original mutex/yield behavior and corrects shutdown's waiter
  accounting only.

These are short live-simulation samples with different opponent positions;
small FPS differences are not controlled A/B evidence. Raw counters and CPU
profiles remain in ignored build/ artifacts. The local-register generation,
compiler flag and temporary duplicate engines have been removed. No original
installation files were modified.

The final standard build passes npm test, test:renderer and test:browser:
165 differential cases, the expanded thread/lifecycle checks, 27 backend
checks, 41 native-driver checks and 72 ABI calls, legacy polling, calendar/input/
range reads, save/mapping/registry persistence and deletion, PCM output, the
339-frame original intro and unbounded Run/Stop/restart. The module remains
about 103 MiB.

Compared all 11360 Wasm function bodies against the baseline engine: only
stop_guest_workers changed, growing by 24 bytes. All other bodies, including
the game translation and normal VM acquisition/yield paths, are byte-identical.
The final eight-second 4K driving check averaged 62.70 FPS, with about 320
native draws per frame versus about 212 in the earlier baseline sample. A
separate unpaced check after the car coasted into a wall averaged 75.71 FPS.
Animation callbacks still run at roughly 165 Hz (median 6.06 ms over 79
intervals). These samples do not establish a speed difference for the shutdown
fix; the workload changed. README reports the observed 63–82 FPS driving range
and retains the unmet 4K/120 target. Latest raw counters are in
build/shutdown-driving-check.json.
