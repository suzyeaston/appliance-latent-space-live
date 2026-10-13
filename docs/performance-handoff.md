# Visual performance and vocal scenes

The canvas is an instrument as well as a display. Drag horizontally to crossfade sine, triangle, saw and square oscillators. Gesture timbre does not change the whole mix’s browning/destruction controls. Vertical movement plays MIDI 48–84. The ring reads real output spectral brightness and high-frequency share; note colour also distinguishes oscillator waveform. No latent or neural model is implied, and the original control-map IDs stay unchanged.

Record visual notes into the phrase overdubs a grid-snapped `visual` voice without changing existing voices. Repeated held pitches are tied. Live/armed/recording/kept state, replay, undo and save-to-set controls are visible near the canvas. The lane uses the last selected waveform; a gesture cannot create unlimited events. Canvas arrow keys provide a live performance alternative. Pointer release, cancellation, lost capture, blur, Stop and Kill release the sound.

Microphone capture is explicit and capped at 20 seconds. MediaRecorder output is decoded, antialiased/resampled to mono 16 kHz, and kept as bounded signed 16-bit PCM. The microphone is never monitored or uploaded. Level, low-pass tone, compensated drive and bounded tempo-linked echo run on a separate vocal path into the existing master limiter. FX sliders update sounding takes; attaching or saving a scene snapshots the take and FX. Each phrase starts its take at bar one and crops playback to the phrase length. Preview, Stop and Kill use the same engine; Kill also cancels microphone requests/recording and clears vocal FX paths.

Scene set version 3 exports include recordings and FX. Versions 1 and 2 still import. Audio and imported FX are validated and file size is capped. Browser storage can fill up or be unavailable in cross-origin embeds: an explicit export is the backup. Music project and visual-library exports remain separate.

Drag block handles to reorder all eight positions (including empty blocks), or use arrow buttons/left-right keys. Saved-scene handles assign scenes to blocks or swap scene slots while preserving block references. Dragging supports mouse/touch pointer capture and edge scrolling. Arrangement edits stop chaining; press Play timeline to restart with the new order.

## WordPress deployment step

Update the existing Custom HTML block's iframe permission:

```html
allow="microphone; autoplay; fullscreen"
```

The iframe URL is unchanged. See `wordpress-embed.html`. The app detects a blocked microphone Permissions Policy and gives guidance to update the iframe or open the standalone instrument. This PR does not edit the production WordPress page or deploy Pages.

## Verified

Node 22, `npm test`: 107 tests passed. `npm run build`: TypeScript and production bundle passed. `npm run test:audio`: 13 real OfflineAudioContext checks passed, including distinct gesture timbres, vocal timing, audible bounded echo and Kill. Existing `npm run test:ui`: 13 checks passed on production preview. `npm run test:performance`: 9 browser interaction groups passed, covering actual MediaRecorder with generated test input, pointer gestures, vocal FX/scene attachment, Kill during recording, mouse/touch ordering, set export/import, timeline playback, permission denial and a cross-origin iframe without microphone delegation.

The fake microphone waveform is generated in a temporary directory and removed; no test or personal recordings are committed. Automated audio checks measure signals; musical sound quality still needs human listening, and microphone behavior should also be checked on the intended mobile browsers.

The later startup-sound/recording-flow audit and updated validation are documented in `musician-qa.md`. Zero synth/vocal drive now uses a native bypass, so polyphonic inputs retain headroom; the older finite-output tests alone did not catch identity-curve clamping.
