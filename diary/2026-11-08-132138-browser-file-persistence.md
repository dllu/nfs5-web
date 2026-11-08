# Browser-local file persistence

The virtual filesystem now checkpoints changes to IndexedDB, keyed by the
executable SHA-256 within the current origin. Loading a runtime restores its
overlay after mounting original assets. The original Wine installation remains
unchanged. Node tests keep their overlays in memory.

Native snapshots include immutable copies of dirty file bytes, directories,
attributes, original timestamps and deletion tombstones. A monotonically
increasing revision tags every change. The host acknowledges a snapshot only
after its IndexedDB transaction commits; writes made during that transaction
remain dirty for the next checkpoint. Deleted slots cannot be reused until their
tombstones are acknowledged. Case variants share a database key.

Checkpoints run every second and before diagnostic startup returns. Storage
errors retain unacknowledged changes and are reported. An abrupt tab/process
close can still lose changes since the last completed checkpoint. Win32
`FlushFileBuffers` currently commits to the memory overlay, with browser storage
following at the next checkpoint. Actual game save/load is not reached yet.

Validation: all existing Node checks pass, with 85 filesystem/path calls now
including a write made after an earlier snapshot and a retained deletion. Chrome
157 writes ten binary bytes through `WriteFile`, commits, reloads the page and
creates a fresh Wasm runtime, then reads back every byte exactly. It deletes the
file, commits and reloads again to verify absence. Original startup, DOM keyboard
input, focus loss and cross-chunk HTTP reads also pass. Startup still stops at
DirectSound creation (`DSOUND!ordinal_1`, caller `00597F70`).
