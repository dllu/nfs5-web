# Game display fills the browser viewport

The user noticed the development browser was presenting the game in a tiny
640-pixel canvas. The interactive harness pinned that CSS width, and the
actual launcher also constrained the game to its 1000-pixel content column.

While the game runs, its canvas now covers the viewport at every aspect ratio.
The original frontend still renders at 640×480 and stretches to the browser
window; the selected race render mode remains independent of its CSS display
size. Stop remains accessible above the game. Completion, Stop and errors
return to the launcher with the final frame and diagnostics.

Mouse button and wheel events now carry their current client coordinates,
just like movement events. The existing canvas-to-guest mapping therefore
refreshes the cursor even if the window was resized without a mouse move.

`npm run test:browser` passes, including new checks for exact viewport bounds
at 1440×1000 and 1100×700, corresponding 640×480 mouse coordinates, button and
wheel positions without preceding movement, and launcher restoration after
Stop and a finite run. Existing startup, input, local persistence, audio,
original intro and fresh-runtime checks pass. The intro presented 341 frames
with peak game PCM 0.950. Evidence: `build/viewport-game.png` and
`.cache/browser-viewport.log`.

The preceding manual check also started the original Evolution 356 Challenge
on Normandie at 3840×2160, opened Pause, and returned through Quit → exit to
game menu without a runtime fault. The pause menu has Continue, Race Again
and Quit; it has no in-race Save command. Some apparent missed clicks in the
manual helper were its 480-normalized Y convention being mistaken for the
360-pixel screenshot height at 16:9. The initial profile transition also takes
longer than the early test inputs allowed. No game-input timing workaround
was introduced.

The user has asked to prioritize visual fidelity and highest-quality settings
before further performance work. Missing menu button gradients are the next
rendering issue to investigate. The full port and the 4K/120 Hz target remain
incomplete.
