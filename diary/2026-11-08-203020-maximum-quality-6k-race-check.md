# Maximum-quality settings persist and load a 6K race

The original graphics controls in the isolated `webtest` browser profile retain
6144×3456×32, Very High textures, High car detail and lighting, Very High world
quality and view distance, Projected headlights, lens flare On and High sky
after a full Chrome restart. Their original save representation is recorded in
`build/quality-highest-settings.json`; no binary save was edited to set them.
Screenshots are `build/quality-{graphics,advanced}-restored.png`.

A fresh game instance entered the Evolution 356 Challenge on Normandie using
those settings. WebGPU reported a 6144×3456 render target and no errors.
Holding Up accelerates the original car; after continuing from Pause, the HUD
showed roughly 70 km/h and second gear. The camera moved with the car. The
browser is left paused in that scene. No FPS optimization or performance claim
was made for this maximum-quality run.

Evidence: `build/race-highest-6k-retry.png`,
`build/race-highest-driving-continued.png`,
`build/quality-continued-gauges-detail.png`,
`build/quality-6k-race-result.json`. The screenshot is stretched to the actual
browser viewport, so its output dimensions differ from the internal target.

One preceding attempt raised an uncaught Wasm memory-access fault during return
from graphics settings. The manual harness then emitted repeated `unwind`
errors. Its asset server was found stopped afterward; the old process and tool
handle were absent and the origin refused connections. I restarted the server
only after confirming that state, enabled bounded full-stack error logging in
the ignored harness, and reproduced the same menu sequence in a fresh browser
instance. That run completed the sequence and entered the 6K race without the
fault. The outage is a possible factor, not an established cause; no runtime
fix for the uncaught fault has been demonstrated. It remains an open issue.

The release code and Wasm hash are unchanged from the gradient fix. A profile
build emitted `build/menu-gradients.js.symbols` for diagnosing a recurrence;
the Wasm SHA-256 remains
`bca85a0b615c2faefd02a957c696dfee36bb290e83fb3081bbdee55c94efa36f`.

Further visual work remains: highest-quality defaults for new profiles
(the supplied template has medium textures), specular/shading behavior,
mipmaps, multitexture and projected-light fidelity. The native driver's embedded
shader references were extracted into ignored
`build/verok-opengl3-{vertex,fragment}.glsl`. The current browser shader omits
native specular RGB addition; Thrash state 6 selects flat, smooth or smooth
with specular in the supplied driver and currently needs implementation review.
Race HUD and pause controls also retain small fixed-pixel sizes at 6K.

The visual audit remains the priority before more performance work. Complete
campaign progression, the unexplained memory fault and 4K/120 Hz remain open.
