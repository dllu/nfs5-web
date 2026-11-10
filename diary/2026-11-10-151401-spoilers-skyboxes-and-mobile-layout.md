# Spoilers, skyboxes and mobile controls

The public packager takes two local addon ZIPs. Zolee's replacements become
the normal 964, 993 and 996 CRP assets. All three loaded in browser races at
Very High car detail. On Autobahn, the stock 996 showed two triangular gaps
under the deployed spoiler at 12.75 seconds. The patched run showed a
continuous grille at 12.78 seconds. Captures are
`build/mods-autobahn-stock.png` and `build/mods-autobahn-fixed.png`.
[Zolee's spoiler fix](https://www.nfsaddons.com/downloads/nfspu/tools/11074/rear-spoiler-fix-veroks-patch-964993996.html)

The GT3 loads its own `gt3.crp`. Its garage view still shows dark patches
on the bodywork beside the inner headlamp edges with the replacements installed.
`build/mods-mobile-gt3-5.png` captures the front view. The cause of that
shading remains unverified.

AndrewD's skybox set uses 24 changed or additional compiled assets in
an optional manifest overlay. Original skies are selected by default.
The preference applies at launch, and the game requests the replacement
files as tracks load. Côte d'Azur rendered with the 6,297,920-byte
replacement, and Monte Carlo 1 rendered with the 4,472,400-byte replacement.
The profile restart check preserved both the preference and save bytes.
[AndrewD's atmospheric skyboxes](https://www.nfsaddons.com/downloads/nfspu/tracks/11357/new-atmospheric-skyboxes.html)

Touch devices use a default 4:3 mode. The driving pad sits below the game in
portrait and in the side gutters in landscape, respecting safe-area insets.
The compact Game menu contains the pause, layout, keyboard, fullscreen
and Info actions. The keyboard accepts names and prices with a blank
field. Fullscreen targets the document so controls remain accessible.

In hardware Chrome with a 3× touch viewport, a GT3 race rendered at
1244×933 and fit a 430×322.5 CSS-pixel picture in portrait and a 573.33×430
picture in landscape. The race stayed active through rotation, all six
button targets stayed outside the picture, and the Game menu opened the
native pause dialog. See `build/mods-mobile-portrait-buttons.png` and
`build/mods-mobile-landscape-buttons.png`. Device checks used emulation.

The Node suite, browser input/native analog checks and packaged browser
checks passed. The public release `1d4b5407349c977b` serves the checked
index and assets with cross-origin isolation and working HTTP byte ranges.

The hidden-race test now samples its baseline after the tab is hidden.
Over 65 seconds it recorded 1,825 race frames and zero canvas presentations.
