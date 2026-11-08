# Keyboard driving and unbounded clock overhead

The original Côte d'Azur race runs in Chrome with a Porsche 356. Holding the
physical Up key accelerates it: a native-resolution HUD capture shows roughly
80 km/h, about 4000 rpm and third gear. Escape opens the original pause menu;
its race-again control restarts the race. These are manual checks, not coverage
of every control or race type. The HUD and pause dialog retain small pixel
sizes at 6144x3456. Menu clicks sometimes need retries.

Run-until-Stop no longer reads the host clock at every original function entry
or periodic loop-yield check. Deadline checks still run for budgeted calls;
cooperative cancellation still runs for unbounded play. Tracing is retained.
The full Node suite passes, including bounded startup, differential execution,
timers, native-thread isolation and Stop/restart in blocked calls. A calendar
EM_JS empty string now also avoids a C preprocessor warning. Browser checks
also pass, including original intro/audio, native calendar calls, persistence
and unbounded Run/Stop/restart.

Two short foreground Chrome race-scene samples at 6144x3456 delivered about
23 frames per second. The views and draw counts differ, so these do not establish
an FPS improvement from removing clock reads. The 4K/120 Hz target remains
unmeasured and unmet. An attempted diagnostic write of the desired 4K settings
was superseded by original mode selection; it did not change the actual target.

The dedicated browser profile contains original game writes in IndexedDB,
including 0arkTest.sav, player.lst, HUD settings and nfs5.trk, and subsequent
runs restore the overlay. Explicit in-game create/save/load flows remain to be
validated. Source installation files remain unchanged.
