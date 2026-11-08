# Run until Stop

Added an unbounded execution mode (`milliseconds=0`) and a cooperative stop
request shared by native Wasm threads. Lifted function entries, loop backedges
and host wait release points observe the request. The primary runner unwinds,
wakes/cancels guest workers and the timer dispatcher, drains graphics commands,
captures diagnostics and checkpoints the browser file overlay before disposal.
Stop does not ask the original game to create a gameplay save.

The static page now offers Run game and Stop alongside its five-second startup
check. It preserves the last frame and can launch a fresh instance after stopping.
The game still needs menu/racing bring-up; this removes the startup time limit
as an obstacle to testing those paths.

All Node suites pass, including 12 lifecycle checks for unbounded message waits,
infinite sleep, a deliberately stalled graphics acknowledgement, timer-dispatcher
wakeup and stop/restart. Chrome passes its existing input/file/registry/audio
checks, a 15-second original intro run (337 presentations with visible video and
nonzero game PCM), and the production page's Run game/Stop/restart flow.

Longer original-code investigation confirms Escape and Enter execute the
original keyboard handlers and are consumed by the guest key ring, although
they have not skipped this movie. Natural movie completion and the transition
to menus are being investigated. No gameplay or high-resolution frame-rate
claim is established.
