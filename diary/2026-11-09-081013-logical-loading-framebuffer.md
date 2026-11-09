# Logical loading framebuffer

The loading-screen software lock now uses the same logical dimensions as its
upload. The driver samples physical readback at logical pixel centers and
returns the corresponding width, height and pitch. It retains that coordinate
space through Unlock, including an unlock outside the original drawing scope.
The loading function's lock call at 004A5371 joins its existing draw/upload
scopes. Normal physical locks, readrect and software movies retain their native
coordinate space. This changes the translated host and one generated game chunk.

A real frontend → Quick Race run on the old engine reproduced the defect at
1600×900: the first two captured presentations had black margins, then four
updates each contained 170,100 nonblack pixels in the checked right margin.
Software uploads extended to 3001.1724×1687.5 because a 1600×900 buffer was
being enlarged as if it were logical UI pixels. Its next Lock read that enlarged
image back into the physical buffer. Loading painted only its centered logical
640×480 region, leaving already enlarged artwork in the unused source margin.
The native 4:3 reference capture has black margins; a fresh same-size native
comparison was not obtained.

The new `npm run test:loading` starts the original game through its startup
configuration, with no external guest routine invocation during execution.
It captures four painted software updates at each of 1600×900, 900×1600 and
3840×2160. It checks black margins outside independently calculated bitmap bounds,
exact viewport coverage and logical source dimensions. The old engine fails its
viewport-coverage assertion. All twelve updated captures passed in Chrome's
SwiftShader adapter, with no WebGPU/page errors. The wide/4K source is 853×480;
the tall source is 640×1138. The software flag is diagnostic only; normal runs
continue to request the hardware adapter. Chromium's
[adapter selection flag](https://chromium.googlesource.com/chromium/src/gpu/+/1098234ba8fc6af2c287a986e68ff979af742762/ipc/service/gpu_init.cc)
selects SwiftShader separately for WebGPU.

The build requires the `browser-logical-framebuffer` generation tag so the
updated driver cannot silently use old generated loading code. A stale manifest
was rejected with the explicit regeneration instruction. Full regeneration and
the release build succeeded. A second regeneration reproduced all 59 generated
C/header files exactly. The final release binary is byte-identical to the one
used by the completed software pixel checks. The updated 56-check UI suite also
passes with the new generation-tag assertion. `npm test` passed, including
56 UI layout, 228 Thrash ABI, 84 graphics transport and 20 lifecycle checks.
Release Wasm: 87,957,962 bytes, SHA-256
`7c25385646cf12d0579e3dba300bdab351d85619433ad02111172cfce4dbe36d`.

During a fresh native reference at 1600×900, display queries and the NVIDIA
control interface stalled. Wine taskkill reported termination; its exact launch handle
subsequently completed with exit 137. Sway/Xwayland resumed responding, but a
fresh normal Chrome loading test then reported no WebGPU adapter. Broader
renderer/browser rechecks and further software adapter probes subsequently
stalled too; the browser check timed out before its first launcher click, and
the other diagnostic runs were closed. An explicit Lavapipe adapter probe also
timed out. These are not passing rechecks. The
original frontend reproduction still needs repeating on the updated hardware
build once adapters respond. The final bounded software-mode attempt timed out
in adapter selection, recorded `passed:false` in `build/loading.json`, and
closed its browser; the earlier completed pixel evidence remains separately
in `build/loading-software.json`. No display restart/reset or changes outside this
checkout were made. The source Wine installation remains untouched.

Evidence: `build/loading-before*.json/png`, `build/loading-regression-before.json`,
`build/loading-software.json`, `build/loading-*-software.png` and
`build/logical-framebuffer-validation.json`. Logs: `.cache/{prepare,build,unit}-logical-framebuffer.log`,
`.cache/loading-logical-framebuffer.log`, `.cache/loading-hardware-logical-framebuffer.log`
and `.cache/{renderer,browser}-software-logical-framebuffer.log`.

This is a visual-correctness change. Broader visual equivalence, full gameplay
and sustained 4K/120 Hz remain incomplete.
