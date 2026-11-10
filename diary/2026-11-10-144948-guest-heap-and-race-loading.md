# Guest heap and race loading

A Showroom Evolution session failed after a 356 Cup in the 356 B Carrera
GS 2000 and a switch to the 911 GT1 for Rally of Europe. The error requested
10,514,432 bytes after Schwarzwald. The guest heap is a fixed range inside
shared Wasm memory. A regression fixture reproduced the exact allocation
error with 12 MiB free split between two adjacent blocks.

The allocator now merges adjacent free blocks, reuses alignment gaps and
chooses the smallest fitting free block. The same request succeeds with
the tail filled. Tests cover both neighboring blocks, aligned virtual
reservations, live neighbor data and tail recovery. Diagnostics expose
live bytes, total free bytes and the largest free span on allocation failure.

Large race framebuffer locks are released when the renderer shuts down or
switches to a smaller mode. The native driver check verifies a 4K lock
round trip and release of its 33,177,600-byte guest buffer. Software loading
art samples logical pixels on the GPU using the original pixel-center
nearest-neighbor calculation. Wide, portrait and 4K loading captures
preserve the centered 4:3 art and black margins.

A cold file read can fetch consecutive requested cache pages together, up
to 2 MiB, with the existing eight-page cache and private I/O staging.
Cross-page byte checks and a delayed HTTP source replacement passed.

## Cold Schwarzwald comparison

Hardware Chrome in the isolated Sway session ran the GT1 with four opponents.
The test disabled the browser cache and added 50 ms to each HTTP range
response. It timed game start through the first rendered race scene. Figures
are individual local runs.

| Output | Ready before → after | Range requests | Range wait | GPU readback |
| --- | ---: | ---: | ---: | ---: |
| 1920×1080 | 17.52 → 15.44 s | 83 → 43 | 4.40 → 2.30 s | 92.5 → 25.9 MB |
| 5786×3306 | 18.11 → 15.65 s | 83 → 43 | 4.44 → 2.30 s | 842.9 → 93.9 MB |

Both builds requested the same 19.0 MB of asset data. The 6K case still
includes a native full-size lock and substantial game loading work.

## Evolution and release checks

At 5786×3306, one Showroom process entered Corsica with the 356 B Carrera
GS 2000, restarted it, then switched to Rally of Europe with the GT1 and
loaded Schwarzwald twice. Race-to-menu transitions used the game's exit
menu. Live guest allocation settled at 60.9 MB after each return. Both
Schwarzwald loads used 160.9 MB live, and the menu retained a contiguous
100.2 MB free block after release. Full championship completion and the
reported finish-line transition remain unverified.

The Node suite, hardware renderer and loading checks, delayed HTTP I/O
checks and packaged profile/persistence check passed. Browser runs used
private headless Sway. Public revision `ba0d8ca2c859ef3d` serves the checked
release with cross-origin isolation and working HTTP 206 ranges.
