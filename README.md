# NFS Porsche Unleashed on the web

[Play in your browser](https://daniel.lawrence.lu/nfs5/).
The original PC executable is statically translated from x86 to C with
pcrecomp and compiled to WebAssembly. Rendering uses WebGPU; the game and
its workers run on Wasm threads. The deployment is entirely static.

## Playing

The public page launches directly into the original game. Click or press a key
for sound. Select **Showroom** for the completed Evolution/Factory Driver
profile, or **Create player** for a fresh career. Arrow keys drive, Space is
the handbrake, C changes camera, and Esc opens the pause menu.

Profiles, graphics preferences and other file changes stay in IndexedDB in
this browser, per site and executable. **Exit through the game's menus to
serialize career progress.** Written files checkpoint every second and when
the tab is hidden. Clearing site data deletes local progress; closing abruptly
can lose unsaved changes. Deleting a supplied profile is persistent too.

A browser with WebGPU and shared-memory Wasm is required. Chrome on the NVIDIA
GB10 is tested; other browsers and GPUs need verification. New profiles and
Showroom use maximum exposed quality and a 32-bit viewport-sized race mode.
Menus render at 640×480 and fill the viewport; race HUD and controls scale
independently of the 3D scene. The system cursor is hidden over the game.

## Current state

Startup, audio, the original frontend, profile creation, quick races and
Evolution gameplay run. A user has completed a race with correct visuals and
usable performance. Car purchases and profiles survive browser restarts.
The Showroom seed exposes the completed campaign's cars and Monte Carlo tracks.
Full campaign advancement remains unverified. Multiplayer, controllers,
custom photo import and many unused Windows APIs are unsupported.

The Thrash backend implements geometry, supplied texture mips, filtering,
blending/alpha tests, depth/stencil, fog, gamma, headlights, weather and
framebuffer transfers. The frontend's nearly touching picture strips share
edges to prevent subpixel black seams. Graphics queue packets are consumed
without copying contiguous payloads, reducing allocations during play. Small
framebuffer reads transfer only their requested rectangle, including the
sun-visibility sample, instead of a complete 4K/6K frame.
**Sustained 4K/120 Hz remains a target, not a verified result.** Microstutters,
intermittent menu input retries and a previously observed menu-return fault
still need investigation. No Wine reference runs are needed for normal work.

The engine uses a 256 MiB guest arena in initially 512 MiB shared Wasm memory,
an eight-worker pool and an approximately 84 MiB Wasm module (8.8 MiB gzip).
It preserves integer MMX, uses double-precision x87 helpers and retains
execution diagnostics; complete binary compatibility is not established.

## Development

Prerequisites: Git, Python 3.10+, Node 18+, npm, and Chrome for browser checks.
Downloaded tools, build outputs, caches and test profiles stay in this checkout.
Supply matching game files and Verok's patch; preparation/staging only read them.

```sh
python3 tools/bootstrap.py
.venv/bin/python tools/prepare.py "/path/to/installation/nfs5.exe"
python3 tools/stage_assets.py "/path/to/installation"
npm run build
npm test
npm run serve
```

The development launcher is at <http://127.0.0.1:8000>. Use **Run game** for
normal play; **Run original startup** is a bounded diagnostic. Browser checks:

```sh
npm run test:browser
npm run test:navigation
npm run test:loading
npm run test:renderer
```

Tests cover original-code comparisons, services, threads, input, audio,
persistence, lifecycle and GPU pixels/transport, including 4K output and
picture-strip seams. Reports and screenshots go to ignored `build/` files.
`NFS5_GPU_SOFTWARE=1 npm run test:loading` selects SwiftShader explicitly.
`python3 tools/build.py --profile` emits a Wasm symbol map.

## Public release

```sh
npm run build:public
python3 tools/serve.py --directory build/public --port 8001
python3 tools/deploy_public.py
```

With the public preview running, `npm run test:public` checks direct launch,
blank-profile defaults and persistence across a complete browser restart. This
check uses Python Pillow for rendered-screen readiness. Set `NFS5_PUBLIC_URL`
to run it against the deployment instead.

The public packager includes only referenced assets, strips installation
players/replays/records, and supplies Showroom plus the original blank-profile
template. It downloads a hash-pinned completed-save archive (requires
libarchive); attribution is in [third-party notices](THIRD_PARTY_NOTICES.md).
User profiles and deletion records overlay these defaults on subsequent runs.
Original binaries, saves and generated game code are not committed to Git.

Deployment copies `build/public/` to `pupserver.linode:/www/misc/nfs5`.
[The Caddy fragment](tools/nfs5.caddy) limits cross-origin isolation headers
to `/nfs5`, serves precompressed Wasm, and caches content-addressed assets.
The deploy script backs up and validates Caddy's configuration before reload.
A different static host must supply `Cross-Origin-Opener-Policy: same-origin`
and `Cross-Origin-Embedder-Policy: require-corp`; byte ranges are recommended.
The staged installation is about 531 MiB and is public when deployed.

See the [progress diary](diary/) for measurements and verification limits.
