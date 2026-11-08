# Startup reaches worker creation

Implemented kernel mutexes, events and semaphores with separate handles and
reference-counted objects. Named opens preserve the existing object's state;
mutex acquisition is recursive, event reset modes differ, failed wait-all
does not consume signaled objects, and semaphore over-release leaves its count
unchanged. Closed handle slots get a new generation so stale handles do not
alias newly opened objects. DuplicateHandle supports closing the source handle.

Added the primary-thread pseudo handle, priority metadata, drive type reporting
for the virtual installation/CD, and multimedia clock capability queries.
Blocking waits still stop with a scheduler diagnostic; no worker is fabricated.

Original startup now reaches `CreateThread` at `0x0055F420`, after 5,944 function
entries. The requested entry is `0x0055F4F0`, initially suspended, with a parameter
block on the creating thread's stack. Its original handshake copies that block
and clears a flag before the parent returns. This establishes that real guest
worker scheduling is needed next.

The trace ring can now wrap several times before startup stops. Added a compact
function-entry bitmap and a generic query so WinMain coverage remains verifiable
independently of the recent trace. The stop report also includes the last import
and its arguments.

Validation: 68 original-x86/Unicorn versus Wasm cases, 31 existing service calls,
54 new synchronization calls, and Chrome/Node startup checks. Original WinMain
is observed even after its call leaves the trace ring.

API references: [CreateMutexA](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-createmutexa),
[WaitForMultipleObjects](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitformultipleobjects),
[ReleaseSemaphore](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-releasesemaphore).
The game remains unplayable; rendering, assets, audio, keyboard input and saves
remain open.
