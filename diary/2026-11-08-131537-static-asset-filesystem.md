# Static asset filesystem

Added DOS path normalization, current directories per drive, logical-drive
queries and a virtual filesystem under `C:\nfs5`. The read-only staging tool
copies 1,721 file/directory records (531.1 MiB) from the installation into ignored
`dist/` content-addressed payloads. It verifies the prepared executable hash and
does not modify the source installation.

File services now cover case-insensitive names, creation modes, read/write
access and sharing, generation handles, shared offsets for duplicate handles,
EOF, seeking, truncation, zero-filled write gaps, directory creation, attributes,
deletion, wildcard enumeration and virtual capacity. A 64 MiB memory overlay
holds writes for the current session; persistence is still pending. Unsupported
overlapped I/O returns an error. Network/device path namespaces are absent.

Native workers fetch static assets using synchronous HTTP byte-range requests;
all guest-visible I/O remains synchronous. A shared 512 KiB cache avoids repeated
reads of the same 64 KiB chunks. Node reads the same staged URLs locally. The
local static server now implements single byte ranges, suffix ranges and 416
responses. Static hosts returning full 200 responses also work.

Validation: 81 filesystem/path calls pass, including an independently generated
binary fixture crossing cache chunks, EOF, negative seeking, sharing conflicts,
duplicate offsets, writes, truncation and enumeration. The full existing Node
suite passes. Chrome 157 verifies a native Wasm worker reading 100 exact fixture
bytes across two HTTP ranges, alongside original startup and DOM keyboard tests.
Original startup reads game data (three reads, two cache fetches) and executes
about 416,686 function entries before `DSOUND!ordinal_1` at caller `00597F70`.
Rendering, audio, gameplay and persistent saves remain unimplemented.

API contracts checked against Microsoft's documentation for
[GetFullPathNameA](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfullpathnamea),
[CreateFileA](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilea)
and [file enumeration](https://learn.microsoft.com/en-us/windows/win32/fileio/searching-for-one-or-more-files).
