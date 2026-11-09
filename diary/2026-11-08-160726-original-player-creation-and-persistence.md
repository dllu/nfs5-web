# Original player creation and persistence

The original create-player flow stopped at CopyFileA, called from 004DE5B0 to
copy FEData/Data/nfs5-1.hud into the new player's HUD file. Implemented file
copying in the virtual filesystem: overwrite/existence rules, DOS paths,
attributes/timestamps, sharing, mapped-source writeback, mapped-destination
rejection and the bounded write overlay. Bytes are staged before replacing an
existing destination so allocation/read failures preserve local saves. API
behavior follows the [Microsoft CopyFileA documentation](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-copyfilea);
sharing and self-copy errors were also checked against Wine's implementation.

Added 93 file-copy calls covering exact multichunk bytes, metadata, self-copy,
invalid/missing paths, read-only/hidden destinations, open readers, incompatible
sharing, live mapped writes, truncation to zero, disk limits and source-read
failure. The full Node suite passes. Chrome also copies a binary save on a
native pthread, restores the original and copy after reload, and confirms both
deletions after another reload; its other browser checks pass.

Created webtest through the original portrait/name dialog in a dedicated local
Chrome profile. The game produced 8webtest.sav (147729 bytes), webtest1.hud (2400),
webtest2.hud (520), and player.lst containing 8webtest. After closing the browser
and launching a new engine/browser session, the original chooser lists webtest
and selects it. All four stored-file hashes match across the restart. Both HUD
hashes also match the staged defaults copied by the game. Original installation
files were only read. Campaign progress and explicit race-save/load remain
unverified; this establishes the new-player flow and durable player files.
