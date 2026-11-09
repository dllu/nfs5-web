# Direct launch, image-strip seams and graphics allocations

The game viewport hides the system cursor. The graphics consumer holds each
queue span until processing finishes and reads contiguous packets in place;
only packets crossing the ring boundary allocate a copied payload. Texture
updates, state snapshots and renderer staging retain their own data before the
span is released. Ordered present/readback/resize/reset barriers remain intact.
The consumer exposes packet/copy counters for diagnostics.

The frontend picture is a set of sixteen rotating strips. Captured geometry
shows approximately 0.04–0.17-pixel gaps between otherwise coincident image
edges. At some animation positions these uncover an entire raster row. The
renderer joins two nearby endpoints only for thin, nearly horizontal textured
frontend quads with matching texture/state, depth and UVs. Both triangle
windings and identity-indexed meshes are supported. Gaps above half a pixel
remain open so the flip animation is preserved. Race geometry is unaffected.

Public packaging creates a separate build/public tree, excludes installation
players, replays and records, and includes the blank-profile templates. A
hash-pinned community save by BL_WCAM2P is renamed Showroom and given maximum
quality plus the viewport resolution. Its Evolution year is 2000 and its
completion flags include Factory Driver; original menus expose Monte Carlo
circuits. Source and archive SHA-256 are in tools/public_build.py and the
third-party notices. Native saves are mounted as defaults; IndexedDB overlays
all subsequent changes and tombstones, so deletion is not undone on reload.

The public page starts without a launcher button or diagnostics overlay.
AudioContext startup does not block game startup without a user gesture; a
click/key resumes sound. Tab backgrounding requests a written-file checkpoint.
Career memory still needs the original game's Exit flow to serialize it.

Deployment copies the static package to pupserver.linode:/www/misc/nfs5 and
adds only a delimited /nfs5 route to the existing Caddy site. The previous
Caddyfile is backed up; validation precedes reload and a failure restores it.
The route supplies COOP/COEP, byte ranges, precompressed gzip and immutable
content-addressed assets. HTTPS returns 200, /nfs5 redirects to /nfs5/, Wasm
uses application/wasm and gzip (9,177,812 transferred bytes), and a 64-byte
executable range returns 206 with the correct Content-Range.

Validation: npm test passes; hardware Chrome renderer tests pass 146 backend
checks, 287 original-driver checks and 450 ABI calls, including both image-strip
windings, indexed strips, preserved animation gaps, 4K output and queue wrapping.
Chrome public startup succeeds without autoplay permission, and canvas cursor
style is none. Manual Showroom checks render its player portrait, cars and
track chooser with Monte Carlo circuits. No Wine process was launched.

An exploratory 6K race sample while another browser frontend and tests were
active gave 24.25 FPS, median frame interval 40.27 ms, p95 46.48 ms, p99 51.29 ms,
maximum 102.69 ms and no GPU errors. This is a contended diagnostic, not a
controlled before/after comparison or evidence of a gameplay speedup. The
change removes per-packet payload allocations; sustained 4K/120 and elimination
of all microstutters are not established. Browser-local evidence is in ignored
build/ screenshots and queue-direct-* JSON.
