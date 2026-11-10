# Separate touch steering and pedals

An iPhone user reports improved normal frame pacing: the latest 600 submission
intervals have p50 15.30 ms, p95 18.10 ms, p99 23.74 ms, four intervals over
33 ms and a 311.64 ms maximum. Their cumulative file statistics include a
232.32 ms maximum synchronous range wait; this snapshot does not establish
whether a range request caused a particular long frame. This change addresses
the requested driving controls rather than claiming another frame-pacing fix.

The touch pad now offers Layout: Joystick/Buttons beside Controls. Joystick
remains the default when no preference exists. Buttons gives the left hand
separate side-by-side left/right keys, the right hand gas above brake, and a
centered handbrake just above the steering row. Camera sits above handbrake.
Gas/brake include up/down symbols. Button mode uses the same scan codes as the
physical arrow keys, retaining the game's keyboard steering behavior; joystick
mode continues to use proportional native axes.

The selected layout persists in localStorage under nfs5-touch-layout, separate
from career files. Missing, invalid or inaccessible storage leaves the default
usable. The layout selector follows pad visibility. Switching layouts, hiding
the pad, focus loss and disposal release virtual inputs; source tracking keeps
physical keyboard keys independent. The toolbar wraps on narrow displays.
Buttons retain text-selection/callout suppression and independent pointer
capture for simultaneous touches.

Browser checks cover 430×932 portrait, 320×568 narrow portrait and 932×430
landscape layouts with no overlap or controls outside the viewport. Real CDP
touches verify held steering/gas, independent release, layout/hide cleanup,
physical-key coexistence and retained layout after controls are recreated.
The original INPUT_poll race test matches a two-finger right/gas press against
physical arrows: signed steering 63 and throttle 126, then both return to zero
on cancellation. Existing proportional steering, pause, name entry, long-press
selection suppression and hidden-tab race checks also pass.

The packaged public check passes direct launch, native audio/preloaded assets,
profile creation and save bytes across a full browser restart, and now checks
that the button-layout preference survives that restart. Screenshots and raw
input/native-packet reports remain in ignored build/ artifacts.

Public revision: 2486591fd8989cea. This is a UI-only release; the content-hashed
Wasm remains f3086de1b91316bae708a9ae57c9f14cf4e91d18a10b10315bb719799bf87cb7,
so an existing browser can retain its engine download/compilation cache.
No Wine process was launched or installation modified.
