The pinned `third_party/nfspu-recomp` submodule is
[paintenzero/nfspu-recomp](https://github.com/paintenzero/nfspu-recomp) at
`c7f0b7559a903b97b1ebbba4d9e339ed9b10ae4e`. We use its modified
[pcrecomp](https://github.com/sp00nznet/pcrecomp) lifter and register/flag helpers.
Their MIT licenses and additional notices are retained in the submodule.
The build adapts a local generated copy of `recomp_types.h` for guest address
translation and physical-alias-aware `rep movs`; the pinned checkout is unchanged.
The upstream native host is not compiled by the browser build. DirectInput
descriptor layouts and ABI helpers are adapted from its MIT-licensed
`src/host/dinput.c`, copyright 2026 Sergei Biriukov. The browser build regenerates
the game translation from the supplied executable instead of using upstream's
generated USA 3.5 sources.
PCM sample/gain conventions are adapted from pcrecomp's
`runtime/win32hle/dsound.c`, copyright 2026 sp00nz, under its retained MIT license.
The WebGPU backend's projection, fog, vertex layout and blend conventions derive
from nfspu-recomp's `src/renderer/thrash.*.glsl` and `nfspu_gpu.c`, copyright 2026
Sergei Biriukov, under the retained MIT license.
The browser Thrash ABI, geometry packing, state mapping and pixel conversion
adapt `src/host/thrash.c` under the same license and copyright.

Generated C, original binaries, game assets, and compiled WebAssembly stay in
ignored local directories. Electronic Arts' game code and assets retain their
original ownership; upstream's MIT license does not cover binary-derived game
code. No game files are included in this repository.

Emscripten/LLVM, Capstone, pefile, Unicorn, and Playwright retain their respective
licenses. The bootstrap downloads them separately into checkout-local caches.
