# Evolution purchase persistence and normal guest exit

The original Evolution menus now have a verified purchase/save/reload path.
In an isolated copy of the browser test profile, `webtest` began Classic Era
1950 with 11,000 credits and no car. Through the original garage and Porsche
Centre, I bought the 1950 356 1100 Cabriolet for 11,000. The garage showed the
owned car, purchase price 11,000, current value 10,890 and account zero.

The game did not serialize this change merely on leaving Evolution. Confirming
the main menu's Exit dialog wrote `SaveData\8webtest.sav`: 147,896 bytes became
150,144 bytes. Its SHA-256 changed from
`cd961c014f33a88330359c648e2d913f90c48507cf8a15c3a344b4a2f686294b`
to `c00d1169daa9fa85d92bc811ba0daee72cfa1c51e2363404799cc36402ca036e`.
After closing Chrome completely and starting a fresh Wasm instance, the stored
bytes were identical. The original Evolution and garage menus restored the
owned Cabriolet, zero balance and 10,890 current value.

That first confirmed exit exposed an unimplemented `KERNEL32!ExitProcess(0)`
from original CRT caller `0x005A2490`. The bridge now records an unsigned exit
code, wakes object/timer/graphics waits, unwinds all guest native stacks and
joins workers. It leaves the browser or Node host alive. Process exit is a
successful guest result with `exited:true` and `exitCode`, distinct from user
Stop, a function returning and a porting error. The launcher displays it.
The existing runtime completion checkpoint persists the files the game wrote.
Native DLL detach callbacks are outside this host's current DLL model.
[Microsoft's ExitProcess contract](https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-exitprocess)
describes process-wide thread termination and the supplied exit code.

The rebuilt game also completed its actual Exit flow successfully in Chrome
157: status zero, empty error, `exited:true`, `exitCode:0`, zero armed timers
and an empty WebGPU error list. The second exit serialized another frontend
state (149,910 bytes); save hashes need not remain identical after the game
writes a new session. Reload identity above compares the first written save
against its untouched restored bytes.

Validation:

- `npm test` passes, including 23 new bounded process-exit checks. These cover
  zero/nonzero unsigned codes, all seven event-blocked workers receiving the
  exit code, diagnostic reuse, and timer-callback exit while the primary waits
  on an unrelated event, Sleep, messages, an idle timer dispatcher, an original
  compute loop or a stalled graphics consumer. Lifecycle checks now total 19.
- `npm run test:renderer` passes: 27 backend checks, 47 native driver checks,
  76 ABI calls and the legacy polling check.
- `npm run test:browser` passes: startup, physical input/focus, HTTP ranges,
  binary file/registry persistence, game intro/audio and Run/Stop/restart.
  The intro check presented 345 frames and reached game PCM peak 0.950.
- Release Wasm: 87,936,637 bytes, SHA-256
  `0ac52c9f56f5eeeeef6d25efe3560ae3ab995e318d6a920f6230927c33028a2b`.

Ignored local evidence is in `build/career-{before,confirmed-exit,reloaded}-saves.json`,
`build/career-reloaded-owned-garage.png`, `build/career-normal-exit-result.json`
and `build/career-normal-exit-saves.json`. Test logs are
`.cache/{unit,renderer,browser}-process-exit.log`.

Menu input still sometimes needs a retry. Long holds did not reliably activate
the Exit dialog's OK button; a 65 ms mouse click succeeded in both confirmed
exits. Earlier Enter/Space attempts showed full-screen video and Escape returned
to the same confirmation, so those frames do not establish an ending movie or
an exit. No speculative MessageBox or cursor-coordinate change was made.

This verifies an Evolution car purchase surviving a full browser restart.
It does not establish race-result saving, tournament advancement, explicit
race Save/Load, complete campaign coverage, or the 4K/120 Hz target. Browser
Stop checkpoints files already written; it does not ask the original game to
serialize unsaved career memory. The original Wine installation was read only.
