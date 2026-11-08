# Original NFS5 startup running in WebAssembly

The repository started without code or commits. The Wine prefix was inspected
read-only; the installed Verok 1.06 `nfs5.exe` is SHA-256
`c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906`.

Found [paintenzero/nfspu-recomp](https://github.com/paintenzero/nfspu-recomp),
which includes a modified pcrecomp lifter and a native host. Its USA 3.5 input
hash differs from ours. Pinned its repository at
`c7f0b7559a903b97b1ebbba4d9e339ed9b10ae4e` as a submodule and used its lifter to
generate a fresh translation of our executable. Its pre-generated game C and
native renderer are not used. Emscripten 4.0.23 and Python/npm dependencies are
installed entirely inside ignored checkout-local directories.

The new host loads the original PE data at guest virtual addresses in a 64 MiB
arena, patches imports to browser-host bridges, and executes the original
`0x005A2D1A` entry point. Unknown calls and unimplemented lifted instructions
produce diagnostics; function entries and loop backedges enforce execution
limits. The initial host implements the startup's memory reservation/commit,
TLS, clock, process, standard handle, environment and some character-conversion
services. It does not implement a full Windows environment.

Discovery found 10,781 function candidates and emitted 1,342,824 instruction
instances, including overlaps. These numbers must not be interpreted as unique
instruction coverage or proof of correct translation. Unsupported 3DNow paths,
interrupts, and floating-point environment instructions remain recorded in the
manifest. The instrumented Wasm module is approximately 72 MiB.

Verification:

- Original startup executes 39 function entries in Node and installed Chrome
  157.0.8103.38, then stops at `KERNEL32!GetStringTypeW`, caller `0x005A98C2`.
- 68 differential cases compare original x86 under Unicorn against Wasm,
  checking all eight general registers and relevant memory or floating-point
  results. Tested routines: `0x0042A130`, `0x0042A160` (range-copy loops),
  `0x004580E0` (201-element object initialization), and `0x0040EF30` (x87
  three-component dot product).
- The Chrome diagnostic page was inspected visually. Reports and the screenshot
  are generated under ignored `build/`.

Next work is the original CRT's character classification/locale initialization,
then the imports reached by static constructors and WinMain. Rendering, asset
access, sound, input, saves and performance targets remain open. No changes were
made to the working Wine installation.
