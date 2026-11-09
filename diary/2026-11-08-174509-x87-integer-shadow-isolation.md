# x87 integer-shadow isolation

The x87 emulation keeps exact int64 shadows alongside its double registers so
FILD/FISTP integer copies do not lose low bits beyond the double's 53-bit
mantissa. The VM saved/restored the doubles when switching guest CPUs, but
omitted those shadows. Reproduced a one-bit error with original code:
81985529216486895 became 81985529216486896 after a worker used the FPU.

The new regression stops original memcpy 005B0100 at an unmapped read, leaving
one to three exact integers live on its x87 stack. A worker runs original dot
product 0040EF30, then the parent consumes its preserved values through original
CRT _ftol 005A0F98 and checks EDX:EAX. Five large positive/negative integers are
tested at each depth with and without the worker, for 60 exact returns. This
uses existing game code and runtime interfaces, with no test-only engine hooks.
The baseline fails the first worker-switch case; the fixed engine passes all 60.

Added the shadow array to saved CPU state and copy it with the other FPU
registers. New guest CPUs start with zero shadows; web_init clears them too.
This also covers CPU snapshots used by asynchronous runs and timer callbacks.
The helper arithmetic still uses double precision; this fixes exact integer
state preservation rather than adding full x87 extended precision.

The standard build and full Node suite pass, including the new check, 165
Unicorn comparisons and existing concurrency/lifecycle checks. WebGPU passes
27 backend checks, 41 native-driver checks and 72 ABI calls. Chrome passes
calendar/input/range reads, persistence and deletion, PCM, original video/audio
and unbounded Run/Stop/restart. README documents the current integer-state
coverage. Original installation files were only read.
