# Native frontend probe restores menu gradients

The user asked to fix visual glitches and select the best visual settings
before continuing performance optimization. The missing button gradients were
real: screenshots from the supplied working Wine installation show highlights
and dark lower edges, while the web frontend submitted only flat red fills.

Original capability setup `0044E890` calls `_THRASH_setstate(451, 0)` at
`0044EB82`, stores its success at `6197AA`, and uses that flag in `004E35E0`.
When the flag is false, original `00521810` returns through a solid rectangle
fallback; when true, it builds the highlighted and shaded Gouraud geometry
through `004D96B0`. The browser driver rejected the probe before that geometry
could reach WebGPU. No shader interpolation fix was needed.

The supplied `opengl3z.dll` accepts the probe without retaining state:
`10009A70` calls `10005450`; state 451 reaches `100069ED` and the common
success return at `1000579D`/`100057B7`. It is outside the retained-state ranges,
so GetState returns `0xFFFFFFFF`. The browser bridge now explicitly accepts
the observed `(451,0)` probe. Other unsupported extensions remain rejected.
The original capability setup consequently enables its detailed UI path.

A temporary diagnostic changed `6197AA` in a running test instance to confirm
the cause; gradients and shadows appeared immediately. That instance was
closed. A fresh unmodified game instance using the rebuilt bridge sets the
flag through original startup and renders the same details. No guest memory
patch or generated-game change is part of the implementation.

Validation passes:

- `npm test`, including 86 Thrash ABI calls. The added checks exercise the
  probe's return and non-retention, then execute original `0044E890` and verify
  its detailed-frontend flag.
- `npm run test:renderer`: 27 backend, 47 native-driver checks and 76 ABI calls.
- `npm run test:browser`, including a new original frontend run. It captures
  source pixels at presentation and checks the opaque Create Player button's
  pale red highlight, red center and dark lower edge. RGBA samples were
  `(215,104,104,193)`, `(181,0,0,246)` and `(88,0,0,192)`. Original Gouraud drawing
  executed and WebGPU reported no errors. Startup, intro/audio, storage,
  stretched viewport input and Stop/restart checks also pass.

Ignored evidence: `build/original-menu-gradients.{png,json}`,
`build/menu-gradients-release.png`, `.cache/unit-menu-gradients.log`,
`.cache/renderer-menu-gradients.log`, `.cache/browser-menu-gradients.log`.
Release Wasm is 87,936,668 bytes, SHA-256
`bca85a0b615c2faefd02a957c696dfee36bb290e83fb3081bbdee55c94efa36f`.

The settings audit found medium texture detail and a 16-bit 4K mode in the
active `webtest` browser profile. The staged new-player template also contains
`Graphics.TextureDetail=2` (medium). Through the original menus I selected
6144×3456×32, Very High textures, High car detail and lighting, Very High world
quality and view distance, Projected headlights, lens flare On and High sky.
Gamma remains at its default 100 (displayed as 25% of the slider range).
Confirmed Exit returned code zero and saved the choices. After a full browser
restart the original graphics screen restored them. The serialized save has
`Graphics.Resolutions=25`, `TextureDetail=4`, `Headlights=1`, `CarDetail=2`,
`CarChrome=2`, `SpecialFX=3`, `ViewDistance=3`, `LensFlare=1`, `SkyRendering=2`.
Evidence is in `build/quality-highest-settings.json`,
`build/quality-graphics-restored.png` and `build/quality-advanced-restored.png`.

This does not establish highest-quality defaults for every new profile or
complete rendering fidelity. In particular, specular lighting, mipmaps and
multitexture still require auditing against the supplied native shader/driver.
The user-directed visual audit takes priority over further FPS work. No Wine
installation files changed.
