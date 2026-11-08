# Native Thrash calls reach WebGPU

Implemented a static replacement for all 41 exports of the supplied Thrash
graphics DLL. Original startup loads `drivers\opengl3z` and queries its metadata;
it now stops at `USER32!RegisterClassA` after about 430,000 original function
entries. The game is not playable and has not submitted its own scene yet.

Native guest workers send rendering commands through a bounded 16 MiB shared
ring. The application Worker consumes copies, batches WebGPU draws, and
acknowledges presentation/readback. Large texture updates use 1 MiB chunks;
backpressure releases the VM lock and observes execution deadlines. A transferred
OffscreenCanvas is connected to the production page. Framebuffer lock/unlock,
read/write rectangles, mode changes and restore/reopen are implemented.

The ABI and conversions adapt the pinned upstream MIT Thrash host. Descriptor
modes include 4K and 6K, without claiming those frame rates. Indexed formats are
not advertised because palette-key fidelity is unresolved. Optional state 37 is
rejected; the supplied DLL's sync export is a successful no-op, confirmed from
its instructions. Full game state and visual compatibility remain unverified.

Validation: all existing Node suites pass, plus 78 loader/ABI calls. Chrome 157
passes original startup, input, range reads, file/registry persistence and PCM
audio integration. Hardware WebGPU passes 27 backend checks plus 33 native-driver
checks and 63 ABI calls, including texture orientation, repeated uploads beyond
ring capacity, 3840x2160 rendering, a full 4K framebuffer round trip, responsive
JavaScript during native waits, and restore/reopen. No WebGPU validation errors.
Reports/screenshots are in ignored `build/`. Normal Chrome is used because its
headless Vulkan adapter is unreliable on this driver. No game FPS was measured.
