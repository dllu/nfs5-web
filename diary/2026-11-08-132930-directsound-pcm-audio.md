# DirectSound PCM and Web Audio output

Added IDirectSound and IDirectSoundBuffer interfaces with guest-visible PCM
memory, reference counts, shared duplicates, primary-buffer format negotiation,
software capabilities, lock/unlock validation, wrapping regions, play/stop,
one-shot/looping state, playback/write cursors, volume, pan and frequency control.
The mixer handles 8/16-bit mono/stereo PCM, linearly resamples to the output rate
and clips the sum of voices. No hardware voices or microphone are exposed.

The application Worker mixes into a small shared stereo ring. An AudioWorklet
consumes it in the browser output graph without entering Wasm or waiting on a VM
mutex. The AudioContext is started from the user's startup button click. This is
an initial audio path; scheduling under game/rendering load is unmeasured.

Validation: 54 DirectSound calls pass, covering exact known PCM values, wrapping
locks, rejected unlocks, end/loop state, cursors, resampling, volume/pan, surviving
duplicates, stereo separation and clipping. The full Node suite passes. Chrome
157 renders a known quarter-scale PCM signal through the running AudioWorklet
graph; its measured peak is within 0.001 of 0.25. Browser startup, input, asset
ranges and persistent binary file/deletion checks also pass.

Original startup creates its DirectSound device and now stops at
`USER32!GetForegroundWindow` from `0058F860`, before window handling and further
sound initialization. Actual game audio, rendering, gameplay and save/load flows
are not yet reached.

Gain/sample conventions were adapted from pcrecomp's MIT-licensed native mixer;
the browser build does not compile its SDL backend. Microsoft's
[buffer locking contract](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/mt708932(v=vs.85))
and Wine's [export specification](https://raw.githubusercontent.com/wine-mirror/wine/master/dlls/dsound/dsound.spec)
were consulted. Ordinal 6 is `DirectSoundCaptureCreate`, with three arguments;
the host returns `DSERR_NODRIVER` and clears its output pointer.
