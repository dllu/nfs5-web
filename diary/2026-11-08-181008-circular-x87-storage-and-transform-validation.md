# Circular x87 storage and transform validation

The translated x87 helpers shifted eight doubles and eight integer shadows on
every push/pop. Added logical register accessors backed by a circular file:
the physical slot for ST(i) is (i - depth) & 7. Push replaces the next slot;
pop clears its old slot and updates depth. Doubles, exact integer shadows and
depth remain part of each saved guest CPU. Arithmetic and control-word helpers
retain their existing double-precision behavior.

Generation adapts both floating-point and shadow subscripts and rejects
unrecognized forms. The build checks the generation metadata before enabling
circular storage, leaving the pinned dependency untouched. --linear-fpu uses
the shifted layout in a separate object cache; that variant also builds and
passes the original-code and integer-state checks. The floating-point result
getter now reads logical ST0 from the saved CPU.

Added a small Wasm fixture that tests both layouts against an independent JS
logical stack model: 24,000 transitions check all eight values and shadows
after pushes, pops, swaps, stores and resets, including signed zero, infinities
and NaN. Expanded the Unicorn suite to 201 comparisons across six entry
routines. New vertex-transform cases use original 005B0730 and its projection
callbacks in all three supported callback-table modes, both 3D/4D input paths,
signed permutation matrices and multi-vertex loops. PE data is restored between
cases so original constants and callback tables are available.

Direct Node/Wasm benchmarks use original routines with unbounded execution,
warmup and five batches. Median results:

| Routine | Shifted storage | Circular storage | Ratio |
| --- | ---: | ---: | ---: |
| 005B0100, thirty 1 MiB copies per batch | 1034 MiB/s | 3275 MiB/s | 3.17x |
| 005B0730, thirty 4096-vertex transforms per batch | 9.87 million vertices/s | 18.84 million vertices/s | 1.91x |

Copy bytes match exactly. Transformed output and clip flags have identical
hashes in both layouts. These routine benchmarks do not establish game FPS.
The engine shrinks from 107,930,112 to 87,935,737 bytes, about 103 to 84 MiB.

The default build passes the full Node suite, including 201 Unicorn cases,
60 exact x87 integer-state returns, 24,000 model transitions and existing
thread/lifecycle checks. WebGPU passes 27 backend checks, 41 native-driver
checks and 72 ABI calls plus legacy polling. Chrome verifies startup,
calendar/input/range reads, persistence/deletion, PCM output, the original
334-frame intro and unbounded Run/Stop/restart.

Manual headed Chrome driving at 3840x2160 with presentation pacing enabled:
642 presents in 8.005 s (80.20 FPS), then 659 in 8.006 s (82.31 FPS) after race
restart. GPU drains at the sample ends took 2.95 and 0.55 ms; no renderer
errors occurred. Screenshots show the advancing road and original HUD. Live
simulation/opponent positions vary; these samples do not demonstrate a game
FPS increase. The 4K/120 gameplay target remains unmet. Current profiling
still shows substantial graphics-barrier waits; raw profiles, the matching
symbol map and measurement JSON files are in ignored build/ artifacts.

README describes the current storage, coverage, build flag, module size and
driving measurements. The original installation was only read.
