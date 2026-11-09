# Shared-memory growth and the race-start readback crash

Reproduced the reported `Invalid graphics readback` with caching disabled while
starting a 911 GT1 race on Auvergne (`castle`) at 6144×3456 with four opponents.
1280×960 worked. The failure is a stale exported JavaScript heap view after a
native game pthread grows shared Wasm memory, rather than an invalid rectangle.

The failing version-8 packet requested 6144×3456 RGBA pixels at destination
365664520. The required end address was 450599176. The host still saw a
402653184-byte (384 MiB) `Module.HEAPU8` view, although the shared memory had grown
to 483196928 bytes (460.8 MiB). Forcing an Emscripten string read refreshed its
internal views and exposed the true length, confirming the diagnosis. Existing
shared-buffer views remain usable but keep their old length after growth.

Export the existing Wasm memory object and install a growth-aware getter/setter
for the module's exported byte view before initialization. Reuse the view until
the memory buffer changes; preserve Emscripten's own assignments when it refreshes
internal views. This covers graphics bounds checks and post-map writes, audio,
file snapshots and diagnostics without increasing the initial allocation or
removing bounds validation. Readback failures now include rectangle, framebuffer,
destination, heap length and packet size for future diagnosis.

Added a GPU regression that grows shared Wasm memory in another Worker, then
reads a rendered rectangle into the newly allocated tail beyond the old view.
It verifies the actual returned RGBA bytes, unchanged prefix-view length and
compatibility with Emscripten export assignments. Added `npm run test:races`:
original GT1/Auvergne loading and driving with four opponents at 1280×960,
3840×2160 and 6144×3456. The 6K case exercises real pthread memory growth.

Validation: full native/Wasm suite; WebGPU backend/native-driver/native-shader
suite; Chrome input, audio, intro, files, persistence and lifecycle checks; and
GT1/Auvergne at all three resolutions. The 6K race uses 460.8 MiB shared Wasm
memory, completes full framebuffer transfers and continues rendering with a
maximum of two GPU frames pending. Screenshots/reports are in ignored `build/`.

Public revision `76e9d739eacd733e` is deployed to /www/misc/nfs5 on
pupserver.linode. The live public check passed on https://lawrence.lu/nfs5/,
including fresh-profile defaults, mobile typing, native-density UI, the close
warning, diagnostics and byte-identical persistence after restarting Chrome.
Existing profiles and storage identities are unchanged. No Wine was used.
