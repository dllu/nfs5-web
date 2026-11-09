# NFS Porsche Unleashed on the web

[Play in your browser](https://daniel.lawrence.lu/nfs5/).
The original PC executable is statically translated from x86 to C with
pcrecomp and compiled to WebAssembly. Rendering uses WebGPU; the game and
its workers run on Wasm threads. The deployment is entirely static.

## Playing

The public page launches directly into the original game. Click or press a key
for sound. Select **Showroom** for the completed Evolution/Factory Driver
profile, or **Create player** for a fresh career. Arrow keys drive, Space is
the handbrake, C changes camera, and Esc opens the pause menu. The on-screen
**Pause** button also opens it. Touch devices can tap menu buttons and use the
virtual joystick, gas, brake, handbrake and camera controls. **Controls** toggles
the driving pad; **Keyboard** opens a name-entry field for creating profiles.

Profiles, graphics preferences and other file changes stay in IndexedDB in
this browser, per site and executable. **Exit through the game's menus to
serialize career progress.** Written files checkpoint every second and when
the tab is hidden. Clearing site data deletes local progress; closing abruptly
can lose unsaved changes. A browser confirmation guards tab close/reload until
the game exits normally; browsers control its wording and may omit it on mobile.
Deleting a supplied profile is persistent too. Switching tabs releases held
controls but keeps loading and simulation running, paced at 30 Hz in the
background. Browser/OS suspension can still stop background tabs.

A browser with WebGPU and shared-memory Wasm is required. Chrome on the NVIDIA
GB10 is tested. Firefox with WebGPU enabled also runs; the isolated Linux
Firefox check selects the llvmpipe software adapter. Other systems and Firefox
hardware adapters need verification. New profiles and Showroom use maximum
exposed quality and a 32-bit viewport-sized race mode. Menus and loading artwork
keep their original 4:3 aspect, centered with black bars when needed. On hardware
adapters, frontend/garage geometry renders at the fitted monitor resolution;
original bitmap art, videos, UI layout and mouse hitboxes retain their logical
640×480 coordinates. Frontend density follows browser resize. Races keep
the selected resolution’s aspect, including a widescreen browser-sized mode.
Mouse coordinates follow the fitted canvas. The system cursor is hidden over
the game.

Adapter selection requests high performance and tries other browser preferences
before accepting a software adapter. Websites cannot override blocked drivers or
force a particular installed GPU. **Info → Copy diagnostics** includes the actual
adapter, browser, logical/output sizes, shared Wasm allocation and GPU queue stats.
When WebGPU reports a software adapter, the public page reduces the default
race mode to about 720p worth of pixels, preserving aspect and the minimum
640×480 mode, and briefly explains that hardware acceleration is preferable.
Explicit saved resolution choices remain available. Hardware adapters retain
the full viewport resolution. At most two presented frames remain queued on the
GPU, bounding accumulation on slow renderers. Frame submissions are not a
measurement of displayed frame rate.

## Current state

Startup, audio, the original frontend, profile creation, quick races and
Evolution gameplay run. A user has completed a race with correct visuals and
usable performance. Car purchases and profiles survive browser restarts.
The Showroom seed exposes the completed campaign's cars and Monte Carlo tracks.
Full campaign advancement and physical mobile/Mac/Windows devices remain
unverified. Multiplayer, hardware controllers, custom photo import and many
unused Windows APIs are unsupported.

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

The engine uses a 256 MiB guest arena in initially 384 MiB shared Wasm memory,
an eight-worker pool and an approximately 84 MiB Wasm module (8.8 MiB gzip).
It preserves integer MMX, uses double-precision x87 helpers and retains
execution diagnostics; complete binary compatibility is not established. Memory
can grow if needed. Browser/GPU/code memory is additional to the shared arena.

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
npm run test:usability
```

Tests cover original-code comparisons, services, threads, input, audio,
persistence, lifecycle and GPU pixels/transport, including 4K output and
picture-strip seams. Public checks cover wide/portrait menu fitting and
clicks with black-bar offsets; loading checks verify 4:3 artwork and the
full-width race canvas at wide, portrait and 4K sizes. Usability checks cover
touch input, short Escape presses, mobile typing and real hidden-tab
loading/racing; the latter uses raw Chrome CDP because Playwright forces tab
visibility. Python Pillow is required for screenshot checks. Reports and
screenshots go to ignored `build/` files.
`NFS5_GPU_SOFTWARE=1 npm run test:loading` selects SwiftShader explicitly.
`python3 tools/build.py --profile` emits a Wasm symbol map.

## Public release

```sh
npm run build:public
python3 tools/serve.py --directory build/public --port 8001
python3 tools/deploy_public.py
```

With the public preview running, `npm run test:public` checks direct launch,
blank-profile defaults, mobile name entry, native-density 4:3 output, adapter
diagnostics, tab-close confirmation and persistence across a browser restart. This
check uses Python Pillow for rendered-screen readiness. Set `NFS5_PUBLIC_URL`
to run it against the deployment instead.

The public packager includes only referenced assets, strips installation
players/replays/records, and supplies Showroom plus the original blank-profile
template. Code URLs carry a content-derived release version, including styles,
Wasm and worker dependencies, to prevent stale CDN/browser caches from mixing
releases. It downloads a hash-pinned completed-save archive (requires
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
