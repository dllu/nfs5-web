# Graphics configuration and desktop queries

Original startup now passes the desktop, OS version, registry, environment and
collation calls before loading its selected graphics driver. The next stop is
`LoadLibraryA(".\\drivers\\opengl3z")`; window creation and rendering are still
unimplemented. Startup executes about 430,000 function entries, varying with
worker/timer scheduling. It reads 67 file blocks with 12 cache fetches before
this stop, and initializes a playing DirectSound buffer.

The virtual desktop has valid identity, geometry, color-depth queries and
reference-counted device contexts. Browser startup supplies its viewport size;
Node defaults to 1920x1080. A 3840x2160 geometry test passes, without implying
rendering or frame-rate performance. The reported display refresh is unknown.

The application registry is separate from the OS registry. Defaults mirror the
working installation's Porsche Unleashed keys, with the install path adapted to
`C:\nfs5`. The original failed Porsche 2000 key lookup runs before its normal
fallback. Registry APIs preserve typed/binary values, case-insensitive names,
access rights, generation handles and buffer sizing. Mutations serialize into
the persisted virtual filesystem. Restoring malformed state leaves live values
intact; failed serialization rolls back a value update.

Process environment setters and immutable, sorted snapshots are implemented.
Wide strings retain UTF-16; byte environment blocks use CP437/OEM encoding, as
specified by the Windows API. The complete CP437 upper table matches Python's
codec. The original `FX_GLIDE_NO_SPLASH=1` setter executes. `CompareStringA`
delegates English comparisons to browser/Node ICU, including case/accent/symbol
flags. This approximates Windows NLS rather than reproducing Windows 9x tables.

Validation: the full Node suite passes, including 68 Windows-service, 31 registry
and 31 desktop calls. Chrome 157 passes startup, native asset ranges, input,
known PCM playback, file/deletion persistence, and a DWORD registry value restored
in a fresh page and Wasm instance. API references include Microsoft's
[registry value contract](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regqueryvalueexa),
[environment block format](https://learn.microsoft.com/en-us/windows/win32/api/processenv/nf-processenv-getenvironmentstrings),
and [device capabilities](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getdevicecaps).

Inspection confirms the supplied OpenGL 3 and DX7 drivers both expose the same 41
Thrash exports. The pinned upstream project has a portable Thrash host and GPU
shaders useful for the next rendering step. No driver binary is committed.
