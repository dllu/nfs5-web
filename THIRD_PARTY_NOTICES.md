The pinned `third_party/nfspu-recomp` submodule is
[paintenzero/nfspu-recomp](https://github.com/paintenzero/nfspu-recomp) at
`c7f0b7559a903b97b1ebbba4d9e339ed9b10ae4e`. We use its modified
[pcrecomp](https://github.com/sp00nznet/pcrecomp) lifter and register/flag helpers.
Their MIT licenses and additional notices are retained in the submodule.
The upstream native host and generated USA 3.5 game translation are not used by
the browser build: this project regenerates its translation from the supplied
executable.

Generated C, original binaries, game assets, and compiled WebAssembly stay in
ignored local directories. Electronic Arts' game code and assets retain their
original ownership; upstream's MIT license does not cover binary-derived game
code. No game files are included in this repository.

Emscripten/LLVM, Capstone, pefile, Unicorn, and Playwright retain their respective
licenses. The bootstrap downloads them separately into checkout-local caches.
