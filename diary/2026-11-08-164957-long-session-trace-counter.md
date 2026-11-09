# Long-session trace counter

The original long-running browser session returned -156394046 function entries
through web_trace_count. The exported 32-bit counter appeared signed in
JavaScript after 2^31 entries, so the snapshot's recent trace became empty.
At 2^32 entries, the separate 32-bit total also wrapped and could replace the
recorded first function. Gameplay continued, but its diagnostics were wrong.

The total now uses uint64_t and crosses the Wasm boundary as a JavaScript Number
through an f64 return. Its getter takes the guest machine lock so the 64-bit
read is coherent while workers execute. The bounded ring retains its wrapping
32-bit cursor; its 1024-entry indexing stays aligned with the wide total.
JavaScript retains exact integer totals through 2^53 entries.

Rebuilt the engine and passed the full Node and Chrome browser suites,
including original startup counts/first entry, differential execution,
native threads, original video/audio and Run/Stop/restart. These routine checks
exercise the new return ABI. A subsequent live driving/restart session reached
4,894,619,600 entries before Stop, retaining the correct first entry (005A2D1A)
and all 1024 recent trace entries across both the signed and unsigned 32-bit
boundaries. Its raw snapshot is in build/trace-count-above-u32.json.
