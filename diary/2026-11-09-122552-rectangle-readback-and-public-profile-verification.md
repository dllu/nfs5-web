# Rectangle readback and public profile verification

A final performance review found that the original readrect ABI requested a
small rectangle but the host allocated and read back the entire render target.
Sun visibility uses a 4×4 sample, making that path particularly expensive at
4K/6K. Transport v8 carries the requested origin and dimensions. The host,
WebGPU copy, mapped staging buffer and JavaScript output now cover only that
rectangle. Original edge clamping, RGB565/ARGB conversion, pixel order,
submission ordering and completion barriers are preserved. Full-window Lock
still requests the full frame, and the consumer accepts older full-frame
packets and all previous state layouts.

The 72 reads in the independent original-code visibility comparison request
18,944 RGBA bytes instead of the equivalent 1,823,342,592 bytes of full frames.
All 64 guarded-readback and 14 flare-state comparisons match original x86,
including edge clamping, 16/32-bit output and 4K/6K modes. This is a transfer-size
comparison in a test sequence, not a gameplay FPS benchmark.

Hardware Chrome checks pass 151 backend checks, 287 original-driver checks
and 450 ABI calls. Added a nonzero-origin 2×4 read at the bottom-right of a 4K
render target: 32 packed output bytes, 1,024 aligned staging bytes, correct
red/green rows, and rejection of an out-of-bounds request. Legacy v1–v7
readback packets also match the rendered pixels. The complete npm test suite
passes against the rebuilt engine, including transport barriers and shutdown.

The image-strip repair was checked against captured original geometry. The
map's separate U/V sampler states are repeat even though its legacy wrap flag
is zero. The repair checks the latter flag and handles both windings and
identity-indexed meshes. Successive live Côte d’Azur map images now show no
black raster row; screenshots are build/map-final-sampler-visible.png and
build/map-final-next.png. Clear/flush boundaries reset the adjacency tracking.

The public browser test uses rendered-button readiness and ordinary mouse/
keyboard input, including explicitly focusing the original name field. It
creates webcheck in a dedicated test browser, verifies 1950, no owned cars and
maximum graphics defaults, closes Chrome completely, then checks identical
stored bytes after restarting. The restored chooser visibly contains both
Showroom and webcheck. The local check and the same check against
https://daniel.lawrence.lu/nfs5/ both pass; screenshots and byte hashes
are under build/public-test*. The live check verifies Showroom completion
flags [1,1,1], fresh-profile flags [0,0,0], and identical before/after save
SHA-256 9d4c438669a3e822c86d947ac95960777171d38a81f98718db5866f6e2abfe3b. The public seed keeps year 2000 and campaign
completion flags while fresh profiles use their original blank progression.

The release is redeployed through the scoped Caddy route. Wasm is 87,964,169
bytes, SHA-256 d121cff8a2a18a7b6e6efa0146babb6462d94ccca8cd29bdff585cfb1af88fb5.
The dev build, public package and decompressed HTTPS download have identical
Wasm bytes. The public packager
continues to exclude installation players, replays and records. No Wine
process was started. Sustained 4K/120 Hz and complete removal of microstutters
remain unverified.
