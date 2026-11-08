# DirectInput keyboard and mouse

Implemented the DirectInput A/Device2A COM interfaces needed by the original
input setup. The host exposes the system keyboard and relative mouse, invokes
the game's translated enumeration callbacks with their original stdcall ABI,
and supports acquisition, immediate state, buffered events, notifications,
reference counts, and foreground focus loss. No joystick is exposed.

The browser adapter sends physical key scans, mouse motion/buttons/wheel, cursor
position, and focus changes to the application Worker. Native updates use the
same machine lock as translated execution. Losing focus releases pressed input
and invalidates foreground acquisition.

Validation: the complete Node suite passes (68 differential comparisons, 31
Windows service calls, 54 synchronization calls, 24 thread calls, 27 timer calls,
and 45 DirectInput calls). Chrome 157 passes original startup and a real DOM
ArrowUp/W input check through the adapter and Wasm device, including key release
and focus loss. Original startup retains both keyboard and mouse objects and
executes about 6,120 function entries before stopping at
`KERNEL32!GetFullPathNameA` from `005916A0`.

The game is not playable: filesystem/asset access, windows/rendering, audio and
save persistence still need implementation. Performance targets are unmeasured.
