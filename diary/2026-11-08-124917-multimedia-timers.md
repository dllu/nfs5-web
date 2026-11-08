# Original multimedia timer callback runs

Implemented timeSetEvent/timeKillEvent with a single dispatcher worker, a table
of timer jobs, and futex wakeups. Idle timers do not spin, and a callback that
reschedules itself does not create a native thread on each tick. The callback
gets the five stdcall arguments and must leave a balanced guest stack. Periodic
timers skip missed intervals instead of accumulating a burst of late callbacks.
Cancellation handles armed and in-flight jobs; synchronous cancellation waits
for a callback already executing. Shutdown wakes and joins the dispatcher.

The original callback at `0x00564EB0` fires and schedules its next one-shot tick.
Both Node and Chrome startup records contain actual callback dispatches. Startup
now reaches `DINPUT!DirectInputCreateA` at `0x0056E940`, around 6,055–6,061 function
entries depending on scheduling.

Networking and telephony are unavailable in this single-player host. WSAStartup
returns WSASYSNOTREADY and TAPI32 loading reports module-not-found; inspected
original code handles these failures and continues without those providers.
GetWindowLongA currently reports invalid-window because no window exists yet.

Updated pending synchronization waits to reserve their completed results when
signaled. Resetting an event cannot revoke a delivered signal; a pulse wakes
current eligible waiters without remaining signaled. Wait-all tests ensure a
pulse cannot be retained until an unrelated object becomes ready. Thread-handle
aliases now share the canonical thread object.

Validation: existing 68 x86/Unicorn comparisons, 31 service calls, 54
synchronization calls and 24 thread calls pass; 27 timer calls cover one-shot
deadlines, periodic delivery, cancellation, stale timer IDs and pulse behavior.
Chrome 157 reproduces the original input-creation stop. Reports remain in build/.

References: [timeSetEvent](https://learn.microsoft.com/en-us/previous-versions/dd757634(v=vs.85)),
[timeKillEvent](https://learn.microsoft.com/en-us/previous-versions/dd757630(v=vs.85)).
Next: a browser keyboard/mouse implementation of the game's DirectInput ABI.
Rendering, asset I/O, audio, save persistence and performance verification remain
open. The working Wine installation was not modified.
