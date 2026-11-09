# Native texture upload comparison

An offline comparison now covers 656,210 generated test texels across the five
advertised formats: ARGB1555, RGB565, BGR888, ARGB8888 and ARGB4444. Each 16-bit
format receives all 65,536 input words and their complements. The 24/32-bit
cases exercise deterministic, distinct per-channel patterns. Smaller textures
include all four supplied mip levels (8×8 through 1×1). Every allocation is
updated twice, with the GPU allocation retained.

The reference executes the original x86 OpenGL3 DLL's talloc and tupdate exports
in Unicorn. Only allocation and GL entry points are replaced by recording stubs.
It records the actual per-level GL dimensions, external format/type and source
bytes; the browser host's shared command queue supplies its converted RGBA8
uploads. All source-byte consumption and mip offsets match. The staged driver
uses TEX_CONVERT_ARGB32=0; this checks that packed-transfer path. It does not
validate the native driver's alternate forced-conversion mode or disabled
paletted formats.

Alpha and all 8-bit/4-bit component projections match exactly. Normalized 5/6-bit
RGB components differ by at most one byte after representation as RGBA8. The
comparison uses the GL format/type arguments to interpret source components,
independently of the host's Thrash format IDs. Its RGBA8 projection is a tightly
packed upload-data comparison, not a GPU readback: GL unpack state, internal
texture storage, interpolation, shading and whole-frame equality remain outside
this check. Normalized component semantics follow
[OpenGL 4.6 §2.3.5.1](https://registry.khronos.org/OpenGL/specs/gl/glspec46.core.pdf).
No rendering implementation was changed on the strength of this bounded result.

`npm test` passes with the new comparison included. The report is
`build/native-texture-uploads.json`; the full suite log is
`.cache/unit-texture-uploads.log`. The engine remains 87,957,962 bytes, SHA-256
`7c25385646cf12d0579e3dba300bdab351d85619433ad02111172cfce4dbe36d`.

The current hardware loading recheck still could not initialize Chrome. The first
attempt timed out in launch after Playwright's 180-second default, before the
old test initialized its report. The loading check now writes its pending report
before launching, caps browser launch at 30 seconds, retains the adapter's
10-second limit, and bounds the complete runtime/capture operation at 55 seconds.
This includes the second adapter request inside runtime construction. Failure
records its actual stage and closes any created context instead of leaving an
older result looking current.

The final hardware attempt timed out at browser launch after 30 seconds and
wrote `passed:false`, `software:false`, stage `browser launch` to
`build/loading.json`. Its exact process handle completed with failure and its
test browser closed. Logs are `.cache/loading-hardware-recheck.log` and
`.cache/loading-bounded-launch-recheck.log`; combined evidence is
`build/texture-upload-validation.json`. There is still no fresh hardware pixel
verification of the loading fix. No native game was launched, no GPU/display
reset was attempted, and the source Wine installation remains untouched.

Visual equivalence, full gameplay and 4K/120 Hz remain incomplete. These checks
remove uncertainty about upload channel order, alpha, packed input consumption,
mip offsets and mutation delivery; they do not substitute for the pending live
visual comparisons.
