# Frontend navigation and saved maximum settings

`npm run test:navigation` exercises the running original frontend in real Chrome
using a fresh, nonpersistent runtime. It opens the supplied player, enters Audio,
Graphics and Display, returns to Audio and then to the main menu at 1440×1000,
1100×700 and 1920×1080. All 16 actions passed with a single 120 ms mouse click,
with 17 observed screens, 404 sampled presentations and no WebGPU or page errors.
The canvas bounds equal each browser viewport, and input follows the same scaling
as the launcher. These transition timings do not measure gameplay FPS.

The observer queues readback at presentation, before the next frame clears its
source texture. It checks selected tabs and panel contents across three samples.
A yellow hovered tab alone does not establish selection: the old red tab and old
panel can remain visible until the game accepts the click. The Audio music-field
border, Graphics Settings highlight and Display panel button distinguish actual
panels from hover states and fades. No guest routine is invoked externally while
the game runs. The host observer counted zero stencil-enabled draws in this menu
sequence; this says nothing about unvisited race effects.

The project-local interactive Chrome profile retained older graphics preferences:
6144×3456×16, medium car detail and vertex headlights. Through the original menus,
I selected the appended browser-viewport mode at 32-bit color, Very High car detail
and projected headlights. All exposed visual choices then matched maximum defaults:
resolution property 26, car lighting 2, car detail 4, world quality 3, distance 3,
headlights 1, lens flare 1, textures 4 and sky 2. Gamma remains the saved 25% setting;
it is a brightness preference, not a detail tier.

Confirmed original Exit completed with status zero, `exited:true`, `exitCode:0`
and an empty error. It wrote `SaveData\0arkTest.sav` (215,837 bytes), SHA-256
`31b9fff4b38228dfbd9d617d78f93ff3555809741e04fd569097e2be428c59ce`.
After completely closing Chrome and starting a new runtime, the saved bytes and
all maximum properties were identical. Changing the browser from 1440×1000 to
1600×900 changed the selected viewport mode to 1600×900×32 while retaining
property 26. Existing profiles generally keep their preferences; this is a
verified upgrade of the local interactive test profile, not a migration policy.
An ordinary Singleplayer → Quick Race start from the restored profile reached
Côte d’Azur at 1600×900×32 with active texture and car tiers both 4, a live sky
and no WebGPU errors. The actual race countdown and paused scene were visually
captured. This confirms that the saved maximum choices reach the race renderer.
Memory reads and screenshots are separate observations, not an atomic capture.
The original Wine installation was not modified.

Ignored evidence: `build/navigation.json`, `build/navigation-main.png`,
`build/navigation-graphics-{0,1,2}.png`, `build/persistent-quality-comparison.json`,
`build/persistent-quality-{settings,advanced,race}.png`,
`build/persistent-quality-race.json`, `build/persistent-quality-race-paused.png`
and the written/restored save inventories. Some earlier dropdown interactions still needed another click;
this check does not establish that intermittent menu input is fixed. The earlier
menu-return memory fault also remains unexplained.

Only the navigation check, npm command and current documentation changed. The
engine is unchanged: 87,957,695 bytes, SHA-256
`d3e72020397f34bcfaee89cafae0fc6ade50dd41970f90e4a00a21635bc8a29a`.
Visual/effect comparisons and full gameplay remain incomplete; performance work
remains secondary to visual fidelity.
