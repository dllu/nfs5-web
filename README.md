# NFS Porsche Unleashed on the web

The original PC executable is statically translated from x86 to C with
pcrecomp, then compiled to WebAssembly with Emscripten. **The port is
incomplete.** Visual fidelity takes priority over further performance work.

## Current state

- Original startup, intro video/audio, the 3D frontend, player chooser with
  nine built-in portraits, quick-race setup and race scenes run in Chrome.
  Keyboard acceleration, pause/Continue and race restart have been exercised.
  Race results and full campaign advancement remain unverified.
  Multiplayer is outside the scope;
  controllers and steering wheels are not implemented.
- The canvas fills the browser viewport. Menus retain their original 640×480
  rendering and stretch to fill it; the race uses its selected resolution.
  New profiles default to a 32-bit mode at the viewport's physical-pixel size.
  Mouse coordinates follow the scaling across resizes. HUD text, gauges,
  minimap strokes, loading artwork and pause controls scale independently of
  scene resolution and remain readable at 4K/6K.
- New profiles use the highest exposed graphics settings: Very High textures,
  car detail, world quality and distance; High car lighting and sky; projected
  headlights and lens flare. Existing profiles retain their preferences;
  16-bit modes cap the active texture tier even when Very High is selected.
  Verok's quality, car-mesh, aspect/camera and guarded visibility hooks are
  translated from the supplied patch. Menu gradients, highlights and shadows
  use the original detailed frontend path.
- A WebGPU Thrash replacement implements the game's geometry/texture submission,
  perspective UVs, flat/Gouraud diffuse and specular shading, blending, alpha
  tests, depth/stencil, vertex fog with ARGB strength, supplied mipmaps,
  filtering/address modes and framebuffer transfers. An OffscreenCanvas consumer
  receives ordered commands through a bounded shared-memory queue. Broader
  scene/effect fidelity remains under audit.
- A browser-local file overlay persists saves and registry changes in IndexedDB
  per origin/executable, checkpointing every second and when play stops.
  Creating players and purchasing the first Evolution car survive a full
  browser restart with identical saved bytes. Confirmed in-game Exit writes
  career changes; Stop checkpoints files the game has already written.
- The host supplies the Win32, DirectInput, DirectSound, filesystem/mapping,
  registry, synchronization and timer services exercised by the game. Original
  guest workers run on Wasm threads with separate CPU/FPU state. Stop and
  process exit wake blocked workers; repeated runtime disposal releases audio
  and worker resources once. The opening-movie portion of the original
  `nfs5.ini` NoMovies setting is honored.

The generated engine contains 10,781 recovered function candidates, including
overlapping instruction ranges; this does not establish complete code coverage.
It uses a 256 MiB guest arena inside an initially 512 MiB shared Wasm memory,
with an eight-worker native pool. The portable CPU reports integer MMX support
while hiding unsupported SSE/3DNow paths. The x87 helpers use double precision;
full floating-point and binary compatibility are unverified. The optimized
Wasm module is about 84 MiB and retains tracing and optional execution limits.

## Validation and remaining work

Manual Chrome runs render Côte d'Azur, Schwarzwald and Zone Industrielle at
6144×3162×32 without WebGPU errors, with active texture and car tiers both 4.
The live camera half-FOV is 48.195°, matching Verok's aspect calculation.
Physical L input switches the projected headlight beam on the industrial
track's road and walls off and on. The same starting straight and toggle have
been visually checked in the native Wine/FEX game. Different viewport/aspect
ratios prevent a pixel-identical comparison. The existing arkTest profile
exposes the same eight tracks in both versions.

Côte d'Azur's pink sunset matches the native scene; its sky mesh also produces
its gradient in an isolated WebGPU pass. The live sun object initializes its
visibility samples and keeps sampling during driving. Visible flare artwork,
weather, other effects and stencil-dependent scenes still need comparisons.
Menu clicks can require retries, and one menu-return memory fault remains
unexplained. Custom photo import/resizing, full keyboard-layout handling and
many unused Windows APIs are unsupported. An abrupt close can lose changes
since the last checkpoint.

**The 4K/120 Hz target remains unmet.** Sustained performance across tracks,
full gameplay and maximum-quality visual equivalence are not established.
Testing currently uses Chrome 157 on the NVIDIA GB10; other browsers and GPUs
need verification. The renderer has a core depth/stencil fallback when optional
32-bit float depth with stencil is unavailable.

Automated checks compare original x86/Unicorn and native Verok DLL execution
against Wasm for copying, transforms, quality, projection, HUD anchoring and
visibility. Fog state handlers are compared against the original x86 OpenGL
driver. GPU pixels are compared against its embedded GLSL for fog, depth clipping,
texture projection and flat/smooth color. All nine portrait pixel planes match
native GIMME conversion.
The checks also exercise Windows services, threads, x87 state, storage,
audio, input and lifecycle behavior. Real Chrome checks cover intro/audio,
menu gradients and portraits, maximum defaults, viewport/input scaling,
persistence and Stop/restart. GPU pixel tests cover native shading, blend/alpha/depth/stencil
semantics, mipmaps, addressing, scaled UI and framebuffer transfers, including
4K output. These checks do not measure gameplay FPS. Detailed evidence and
limitations are recorded in the [progress diary](diary/).

## Build and inspect locally

Prerequisites: Git, Python 3.10+ with venv, Node 18+, npm and Chrome for browser
checks. Downloaded tools, temporary files, build outputs and browser profiles
stay in this checkout. Supply your own game files and matching Verok patch.

```sh
python3 tools/bootstrap.py
.venv/bin/python tools/prepare.py "/path/to/your/installation/nfs5.exe"
python3 tools/stage_assets.py "/path/to/your/installation"
npm run build
npm test
npm run serve
```

Open <http://127.0.0.1:8000> and select **Run game** to play until **Stop**.
**Run original startup** performs a five-second diagnostic run. The launcher
retains its final frame and reports failures and recent original functions.
With the server running:

```sh
npm run test:browser
npm run test:renderer
```

Reports and screenshots go to `build/`. Renderer checks use normal Chrome;
headless Vulkan initialization is unreliable on this machine.
`python3 tools/build.py --profile` emits a Wasm symbol map.
`--optimize 1` and `--linear-fpu` use separate object caches for compiler and
x87-layout comparisons; the default build uses optimization level 2.
Development runs can force the intro with `loadRuntime({intro:true})`.

A static host must send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`; `dist/_headers` supplies these
for hosts supporting that format. HTTP byte ranges improve asset loading;
full-file responses also work. Staging copies about 531 MiB for this
installation. Serving `dist/` exposes the executable and staged game assets.
Original binaries, generated game C and compiled output are ignored by Git.

The tested executable has SHA-256
`c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906`.
Preparation reads the matching Verok `nfs5.dll` beside it; `--patch-library`
selects another path. On this machine the read-only input is:

```text
~/wines/prefixes/nfs5/prefix/drive_c/Program Files/Electronic Arts/Need For Speed - Porsche Unleashed/nfs5.exe
```

## Native visual reference

`python3 tools/native_reference.py` copies the installed Wine prefix into
`.cache/native-reference/prefix` on first use. Bubblewrap keeps the source
installation and other filesystem locations read-only, with project-local
caches and temporary files. The reference copy retains its own settings/saves.
`--dry-run` prints the command; arguments after `--` run an alternate Wine
program in the same prefix. The optional 32-bit
[native memory reader](tools/native_memory.c) snapshots the reference game's
code/data without modifying its process. On Sway, focus the Porsche container
before sending X11 input; activating only its X11 window can leave it unfocused.
The reader accepts a direct address or `@address` to follow a stored 32-bit
pointer before taking the snapshot. With the reader built and reference running,
`python3 tools/native_sun.py build/native-sun` records display/sun data as JSON
and raw snapshots; `--window <X11-ID>` also captures its image. Live reads and
the image are separate observations, not an atomic frame capture.

`src/` contains the browser host, `web/` the launcher/backend, `tools/` the
build pipeline and `tests/` the execution checks. See
[third-party notices](THIRD_PARTY_NOTICES.md) and the [diary](diary/).
