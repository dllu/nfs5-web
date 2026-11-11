# Fullscreen race resizing

The default race mode follows the browser viewport during play. The renderer
applies the new size between frames, updates the game's clipping and camera
projection, and repositions the HUD using its active layout. The countdown
keeps its animation progress as its center moves.

The public browser test starts a race in a 900×1100 viewport, enters fullscreen
at 1920×1080, and returns to the original size. It checks the canvas pixel size
and its bounds against the viewport at each step. The test also starts the
game at 1280×720 to cover a viewport that matches a fixed resolution preset.

Chrome screenshots verified the centered countdown, rear-view mirror, gauges,
and minimap after expanding from the narrow window. The unit suite passed.
The public release `2542e0278ec8730e` was deployed to `daniel.lawrence.lu/nfs5/`.
The served HTML, launcher, worker, runtime, and WebAssembly match the package.
