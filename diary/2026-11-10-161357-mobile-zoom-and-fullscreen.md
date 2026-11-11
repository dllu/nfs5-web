# Mobile zoom and fullscreen

The visible touch pad gives the page background a viewport-sized hit area
with the same gesture policy as the pedals, steering controls, and game
canvas. Rapid taps that miss a control now land on that background.

The Game menu uses native fullscreen where available. On iPhone it shows
Safari's Add to Home Screen instructions, and the page supports launching as
a standalone web app. Safari and the Home Screen app have separate saves.
The existing backup controls transfer profiles between them.

Mobile-emulated Chrome verified rapid taps on the gas pedal and in the
surrounding gap, unchanged viewport scale, and fullscreen entry and exit.
The iPhone menu fallback was checked with the native API disabled and
`navigator.standalone` set to false.

Deployed public release `64a4a4adb4c536e9` through `tools/deploy_public.py`.
The live HTML, stylesheet, controls, launcher, and save backup module match
the packaged files and carry the cross-origin isolation headers.
`npm run test:usability` passed locally. `npm run test:public` passed against
the deployment, including native fullscreen and save backup round trips.
