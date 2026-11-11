# Mobile portrait controls

Portrait races use 4:5 above 700 CSS pixels tall and a square view on shorter
screens. The game sits below the hamburger menu with an 8-pixel gap. The
remaining space below the picture becomes the driving pad, with wider
left/right buttons spanning its height. Landscape steering fills the space
below Camera and Handbrake, and the pedals leave room for the menu.

The launcher reads the portrait aspect from the stylesheet and requests that
aspect from the live race renderer within the existing touch pixel budget.
All driving buttons turn red while pressed. Camera gets pointer feedback and
fires once per tap, with keyboard activation supported too.

The browser usability check passed across 430×932, 390×844, 375×667, 320×568,
and 932×430. It checks control bounds, spacing, top alignment, held colors,
touch cancellation, simultaneous steering and gas, Camera taps, fullscreen,
and zoom suppression. The native analog/input check also passed.

A running race through the public launcher verified 640×800 render pixels in
the 430×537.5 portrait picture, 640×640 on a smaller phone, and a 4:3 landscape
view after rotation. Screenshots include steering and gas held together.
Release `5ecea129233d4f1f` is deployed at `daniel.lawrence.lu/nfs5/`. Its HTML,
launcher, stylesheet, controls, and display configuration match the package.
