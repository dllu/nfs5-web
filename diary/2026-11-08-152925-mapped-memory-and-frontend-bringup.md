# Mapped memory and original 3D frontend

The original intro completes naturally, then frontend initialization needs
CreateFileMappingA and VirtualProtect. Implemented named file/pagefile mappings,
distinct 64 KiB-aligned guest view addresses, shared backing for overlapping
views and separate mapping objects of the same file, private copies, view and
handle lifetimes, writeback and checkpoint integration. Mapped-file truncation
is rejected while the mapping remains live. Backing is bounded to 128 MiB in a
512 MiB guest view range, separate from the 256 MiB flat arena.

The build makes a local copy of the pinned memory header with an address hook
before its inline helpers. This covers scalar/x87/SSE accesses and bulk copies
without changing the submodule. A regression test caught rep-movs incorrectly
using virtual-address distance to select memmove when distinct views physically
overlap. The helper now checks translated addresses and preserves sequential
x86 copying in that case; zero-length copies avoid translating unused addresses.

Virtual memory tracks reservation ownership, commitment, page rounding and
protection changes, including view access compatibility. The flat Wasm arena
does not trap prohibited page accesses; these tests establish API metadata and
mapping behavior, not a complete memory-protection implementation.

Read-only inspection of the supplied nfs5.dll confirmed patch version 0x60001
and the NoMovies jump from 004DD611 to 004DD70B. The static translation preserves
that jump's original stack/register effects under a host configuration check.
nfs5.ini and a persisted override supply the opening-movie preference; forced
playback remains available for testing. This avoids waiting through the entire
movie during frontend work. Other native-patch options remain incompletely ported.

The optional gimme.dll exports only the portrait converter. Its original caller
checks load failure and uses a fallback. The host reports that PE converter
unavailable, supports FreeLibrary's failure/resident-binding behavior, and lets
the caller continue. Custom portrait import remains unsupported.

Chrome now submits tens of thousands of original frontend draws and renders the
3D room with acquired keyboard/mouse devices and nonzero game PCM. Typed keys
execute original handlers and are consumed by its key ring. The captured room
still lacks a verified menu layout; racing and saves are not established.

Validation: 68 existing x86/Unicorn comparisons, 85 Windows-service, 38 virtual
memory, 86 mapping, 10 configuration and all existing service/lifecycle suites
pass. Mapping tests include real lifted rep-movs, object initialization and x87
accesses, backing growth, alias order, checkpoint writes and complete resource
release. Chrome verifies native-worker range-backed mappings, coherent views,
mapped-write persistence across reload, both intro settings, original movie PCM,
and Run/Stop/restart. Hardware WebGPU pixel/batching and 4K framebuffer checks pass.
Artifacts remain ignored under build/; no gameplay FPS is claimed.

API semantics were checked against Microsoft documentation for
[file mapping](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createfilemappinga),
[views](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-mapviewoffile),
and [VirtualProtect](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-virtualprotect).
