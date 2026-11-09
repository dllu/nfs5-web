# Projected headlights and safe runtime disposal

The preceding goal turn made concrete progress in `94dd953` (Verok visibility
hooks and the MMX capability needed by flare initialization). This turn
continues visual comparison before performance work.

## Matched industrial-track comparison

The existing arkTest profile exposes the same eight tracks in the browser and
native game, including Zone Industrielle. The new visuals profile's smaller
catalogue had prevented the earlier comparison; no unlock logic was changed.

The bundled arkTest save selects resolution index 12 and Headlights=0. In the
browser's mode list that resolution is 6144×3456×16, which caps texture quality.
For this comparison, only Graphics.Resolutions and Graphics.Headlights were
changed to 26 (32-bit browser viewport) and 1 (projected). This was done in the
browser-local save overlay after stopping its runtime, preserving the staged
asset and original Wine installation. The original game subsequently loaded
and serialized the profile itself.

Chrome renders the selected Zone Industrielle starting straight at
6144×3162×32, with active texture/car tiers both 4, Headlights=1 and no GPU
validation errors or runtime failure. Physical L input removes the projected
beam from the road and walls; a second L restores it. The sampled road region
is identical between the two browser lights-on captures.

The native reference renders the same starting straight at 1152×864×32, shown
in a 1728×1296 Wine window. Its L toggle also removes the beam. A fixed road
region (normalized x=0.2–0.8, y=0.52–0.8) has these mean RGB values:

| Version | Lights on | Lights off |
| --- | --- | --- |
| Native Wine/FEX | 99.57, 87.87, 45.16 | 50.55, 41.09, 11.97 |
| Browser | 97.88, 85.47, 41.96 | 52.41, 42.36, 12.09 |

These are supporting on/off observations, not pixel equality across versions.
Aspect ratios, presentation scales, race times and opponent states differ.
The comparison establishes a visible beam under the selected projected-light
setting. It does not establish all scene/effect fidelity.

For reliable native input on this desktop, use Sway container focus (for
example `swaymsg '[title="^Porsche$"] focus'`) before XTest keys. X11 window
activation alone left the native game unfocused. Browser and native input
must not compete for focus during queued interactions. Also, 006197F8 stays
11 across a successful L toggle: it describes lighting capabilities, rather
than the per-car light switch. The rendered pixels are the toggle evidence.
The original dropdown menus use press/drag/release selection.

Race → Quit → Exit to game menu completed. Escape from the intervening movie
returned to the original main menu without a runtime failure. This does not
resolve the earlier intermittent menu-return fault. After the game wrote its
profile, the stored 215,560-byte save retained Resolutions=26, Headlights=1,
TextureDetail=4 and CarDetail=4. Data inspection locates property names as byte
sequences; UTF-8 string offsets are unsuitable for these mixed binary saves.

Local evidence: `build/headlight-comparison.json`,
`build/headlight-profile-audit.json`, `build/headlight-saves-after.json`,
`build/native-headlight-current.png`, `build/native-headlights-sway-focus.png`,
`build/browser-headlight-{industrial-setup,industrial-race,menu-ready}.png`,
and `build/browser-headlights-{off,on-again,paused}.png`.

## Cleanup regression

While configuring the isolated comparison instance, calling runtime.dispose()
again from final cleanup aborted in `_free`, reached through audio.mjs's
detach function. Disposal unconditionally freed the audio pump's Wasm block
and reran shutdown even after the runtime was already disposed.

Disposal now checks and sets its disposed flag before releasing resources.
The lifecycle test attaches a real Wasm audio pump and disposes the runtime
three times, including its finally block. The Chrome PCM test also repeats
disposal with its AudioWorklet attached. Both exercise the previously failing
resource path. Node passes 20 lifecycle checks and the nested 43 blocked-wait
and 23 process-exit checks; `npm run test:browser` passes its full suite,
including intro/audio, gradients, maximum defaults, persistence, physical
input, viewport resize and Stop/restart. `git diff --check` passes.

No C, shader or Wasm changes were required for the headlight comparison or
cleanup correction. The module SHA-256 remains
`c71192a7df990cd21e8005329b7bce4f24141609e7f1b8a654dda6594dfb82c9`.
Logs are `.cache/build-audio-disposal.log`,
`.cache/lifecycle-audio-disposal.log` and
`.cache/browser-headlight-disposal.log`.

README now concisely records current capabilities, visual evidence, limitations
and build/reference instructions. Visible flare artwork, weather, other
effects, broader gameplay and the 4K/120 Hz target remain unverified. The goal
is incomplete and no performance optimization was attempted.
