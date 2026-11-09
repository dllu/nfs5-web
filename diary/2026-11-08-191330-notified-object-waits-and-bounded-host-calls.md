# Notified object waits and bounded host calls

Traced original timer initialization: 004A5444 requests 128 Hz from 00565030.
Original 00564EB0 schedules one-shot multimedia callbacks; original worker
00565270 waits on their event and invokes registered callbacks, including
004A45D0. Race counters then advance at 128, 64 and 32 Hz. An eight-second
Chrome driving profile confirms those rates, including the 32 Hz counter at
5E99B8. Its role in physics has not been established. There is no evidence of
lost master ticks in this sample.

Kernel-object waits used a one-millisecond sleep/recheck loop. They now park
on a shared atomic epoch. Event, mutex, semaphore and thread completions
reserve/deliver their results under the existing VM lock, then notify waiters.
The epoch is captured before releasing the lock, so a signal between unlock
and native park cannot be lost. Unrelated wakes recheck the same pending wait
and retain its original timeout. Manual/auto events, pulses and atomic wait-all
keep their existing reservation behavior. The VM mutex/yield policy is unchanged.

Stop, normal primary completion, worker shutdown and fatal errors notify
blocked object waits. Timer notification is separated from timer-table cleanup
so Stop can safely notify an idle dispatcher without acquiring the VM. Errors
also wake that dispatcher. No new public runtime API or test-only guest hook
was added.

Found and fixed finite-budget failures while adding these waits:

- On the baseline, an infinite kernel-object wait ignored a 40 ms run budget;
  the regression's 500 ms watchdog had to request Stop.
- An idle timer dispatcher required its own Stop/error notification. Without
  that path, the extended fixture hit an external four-second timeout.
- A one-millisecond Sleep could return success after its one-millisecond run
  budget expired. Sleep now checks the budget on return as well as while waiting.

A common native-wait helper bounds object and timer parks by the remaining
diagnostic budget and checks cancellation/error state after reacquiring the VM.
Unlimited play retains infinite waits without periodic kernel-object polling.

Added 43 blocked-wait checks, run by lifecycle.mjs in a subprocess with a
15-second guard against lost wakes. They cover finite budgets, 32 signal races,
seven parked original 0055FB90 workers, wait-all completion, normal primary
return with blocked workers, Stop and original compute-worker failure while
the primary is blocked on an unrelated event or idle timer dispatcher.
The suite now has 18 lifecycle checks.

An isolated Node benchmark schedules a seven-millisecond event timer, then
waits on the event. Eighty measured samples follow ten warmups. Median excess
wall time was 0.374 ms with polling and 0.362 ms with notifications; p95 was
0.414 and 0.796 ms respectively. This does not establish a reliable latency
gain. Raw data is in ignored build/event-wait-*-final.json.

Headed Chrome, 3840x2160, presentation pacing enabled, ArrowUp held, eight-second
CPU-profile samples:

| Wait implementation | Presents | FPS | Draws/present | Master Hz | 6559EC Hz | 5E99B8 Hz |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Polling | 686 | 85.71 | 201.7 | 127.93 | 63.97 | 31.98 |
| Notifications | 684 | 85.44 | 202.3 | 128.03 | 63.95 | 31.98 |

The counter rates remain correct and these samples show no gameplay FPS gain.
Scene/opponent positions vary. A subsequent unprofiled coasting sample reached
80.32 FPS, with no renderer errors and a 0.53 ms GPU drain. Keyboard driving,
audio and native-resolution rendering remain functional. The 4K/120 target is
unmet. The notified profile precedes the final Sleep-return budget check;
its matching symbol map is build/wait-notifications-before-sleep.js.symbols.
The final map is build/wait-notifications-final.js.symbols. Raw profiles and
screenshots remain in ignored build/ artifacts.

The normal production build matches the profiled candidate's Wasm SHA-256:
`c8449ae613bbf80e7c72949fe8ee0445db38fe758ecc4daae4bfad3c680b3cc6`.
README describes the notified waits, bounded host calls, expanded checks and
latest driving measurement. The original Wine installation was only read.

Final production validation passes the full Node suite, including all 43 new
blocked-wait cases and existing CPU/FPU, timer, synchronization and lifecycle
checks. WebGPU passes 27 backend checks, 47 native-driver checks and 76 ABI
calls plus legacy polling. Chrome passes calendar/input/range reads,
persistence/deletion, PCM, a 327-frame original intro with peak 0.950, and
Run/Stop/restart. No experimental VM scheduling changes are included.
