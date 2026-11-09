# Optimized Wasm build and 4K sampling

Changed the default compiler/linker optimization from -O1 to -O2 after comparing
the original quick race and running the full regression suites. The engine
shrinks from 131,905,006 bytes (125.79 MiB) to 107,924,755 bytes (102.93 MiB),
an 18.18% reduction. Tracing, Stop checks, thread support and optional diagnostic
execution limits remain enabled. --optimize 1 retains the previous compilation
level; separate object caches let both builds be reused for comparisons.

Selected the webtest player and its original 3840x2160 graphics setting in
headed Chrome, then drove the Côte d'Azur quick race with Up held. Eight-second
unprofiled samples with focused game input and presentation pacing enabled:

| Build | Presents | Seconds | FPS | Final GPU drain |
| --- | ---: | ---: | ---: | ---: |
| O1 | 616 | 8.007 | 76.93 | 0.88 ms |
| O1 after race restart | 647 | 8.006 | 80.81 | 0.46 ms |
| O2 | 658 | 8.008 | 82.17 | 0.76 ms |
| O2 after race restart | 647 | 8.007 | 80.80 | 1.11 ms |

Screenshots confirm advancing road position, visible original HUD and no pause
dialog; the renderer reported no errors. These runs have live simulation and
different opponent positions, so they do not establish a small speed difference
between optimization levels. The repeat samples have almost identical frame
rates. The smaller engine is the demonstrated improvement; 4K/120 remains unmet
in this scene. Raw counters, screenshots and separate CPU profiles are in
ignored build/compiler-*.json, build/perf-*.png and build/game-cpu-o*.json.

The O2 engine passes the full Node suite, all 27 WebGPU backend checks, 41
native-driver checks and 72 ABI calls, plus legacy polling after idle. Chrome
also passes calendar/input/range reads, binary save/mapping/registry persistence
and deletion, known PCM output, the original intro (339 frames, PCM peak 0.950)
and unbounded Run/Stop/restart. The normal build command reuses the O2 cache and
relinks successfully. README now describes this build's size and driving
measurements. The trace-counter diary also records subsequent verification
through 4.89 billion entries with a full recent trace.
