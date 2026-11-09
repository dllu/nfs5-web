# Built-in player portraits

The previous turn committed `6e99d3e` (repeatable native sun snapshots).
This turn fixes another visible frontend discrepancy before performance work:
the native player chooser displays its portrait, while the browser left the
image box blank.

The original portrait method `004DBBA0` searches custom-photo files, otherwise
selects a frame from `FEData/Art/ALLdrivr.fsh`. It loads `gimme.dll`, calls its
cdecl `ConvertFile(source,destination,frame)` export, then loads the resulting
`SaveData/pic16.fsh`. Rejecting the DLL was not limited to custom photo import:
it also skipped the load of the built-in portrait.

`src/gimme.h` supplies the built-in FSH path and static module/export binding.
It expands the atlas's 256-entry RGB565 palette to the original 54×64 image,
or reads an already-converted RGB565 image. Output is a valid 6,960-byte,
single-image FSH accepted by the original portrait loader. Its pixel plane is
identical to native conversion; the encoded container omits the native writer's
additional trailing bytes. File access uses the existing virtual filesystem,
including sharing, read-only attributes, mapping restrictions and checkpointed
write overlays. Unsupported formats, resizing and malformed data fail without
replacing the previous image. This is not a full port of GIMME's custom codecs.

Native comparison uses `tests/portrait_native.c`, compiled with the installed
i686 LLVM/MinGW compiler and run through `tools/native_reference.py`. This
invokes the supplied DLL in its own process, without injecting calls into a
running game. Its SHA-256 is
`3a43b0f6a1608f69adc3a5009c9fe055a24e17197e85c4045c2c43e37eb75f6b`;
the atlas SHA-256 is
`2f688f7c648c9727bbbddbfe9c36c52c7119a53af6fa9a9773d399dd1f5cb58b`.
All nine native output images have exactly the same 6,912 RGB565 pixel bytes as
the port's conversions. Native pixel hashes are recorded in the new automated
portrait checks; no original image payloads are committed.

Validation passes:

- `npm run build`; Wasm 87,951,360 bytes, SHA-256
  `9b322cbc2b219e0e244e41e3461b4f72b4c846a1b6e3f3f9029e156244784462`.
- `npm test`, including all nine native portrait comparisons, cdecl stack and
  callee-saved registers, module lookup, in-place conversion, sharing/read-only
  failures, malformed input and preservation of the previous image.
- `npm run test:browser`. The original frontend renders its face (2,243 colorful
  pixels in the portrait region), writes the 6,960-byte FSH, retains the original
  gradient pixels, and reports no GPU errors. Maximum defaults, 32-bit viewport
  mode, intro/audio, input, persistence and Stop/restart also pass. The first
  run caught a new test helper passing shared bytes to TextDecoder; copying the
  snapshot name bytes fixes that test helper, and the rerun passes.
- Manual fresh Chrome at the 6K display shows the selected arkTest face in the
  stretched player chooser. Its local image cache persists as 6,960 owned bytes,
  SHA-256 `385735ac626b6afc7e297a833454b74fff9d232c1ae1fe008387c8f66122ff3f`.
  A further full browser restart again shows the face and retains that image
  hash. Both existing player save hashes remain unchanged by conversion.

Ignored evidence: `build/native-portrait-*.fsh`,
`build/portrait-native-comparison.json`, `build/portrait-player-chooser.png`,
`build/portrait-live-saves.json`, `build/original-menu-gradients.{png,json}` and
`build/portrait-restarted-{chooser.png,saves.json}`, plus the portrait build/test
logs in `.cache/`. README documents current portrait
support and keeps custom photo import/resizing explicitly unsupported. Visible
flare artwork, weather, broader gameplay and the 4K/120 Hz target remain open;
the implementation goal is incomplete.
