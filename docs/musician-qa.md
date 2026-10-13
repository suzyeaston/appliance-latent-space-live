# Musician workflow QA: startup sound and recording

Reviewed the deployed main source following PR #16, using Node 22, Chromium, real Web Audio offline renders and browser interaction tests. This is signal and interaction QA, not a human listening review or a test of the user's speakers/browser setup.

## Confirmed defects and fixes

| Finding | Musical consequence | Change in this follow-up |
| --- | --- | --- |
| Destruction at zero used an identity waveshaper curve. Web Audio still clamps that curve's input to ±1. The default Service Elevator phrase reached 3.017 before this stage. | Chords/drum transients distort upstream of the master, even when the final output stays below clipping. Lowering the master cannot remove distortion already created. | Zero drive now uses the native null-curve bypass for synth and vocals. Intentional drive remains available. A regression compares a polyphonic render against a true bypass. |
| Canvas dragging changed global browning and destruction, then autosaved those settings. | Playing a lead unexpectedly changes the backing mix, and that distorted mix can return on the next visit. | Timbre changes stay on the held gesture oscillators. FX remain explicit controls. Reset synth FX restores browning .35, destruction 0 and memory .25, without erasing music or vocal takes. Restored drive is visibly disclosed. |
| Clicking played sound, while an understated checkbox determined whether notes were kept. | It was difficult to tell whether a take was being recorded, where it went, or how to hear it again. | Explicit LIVE / NOTES ARMED / RECORDING NOTES / TAKE KEPT state. Recording explains that it saves grid-snapped notes and the final waveform, not microphone audio or the complete timbre path. Replay, Undo and Save phrase to set are next to the canvas. Keyboard arrows remain live performance only. |
| Holding a pitch recorded a separate attack at every grid subdivision. | Replay was staccato even when the performed note was sustained. | Adjacent recorded steps at the same pitch become a tied, sustained note. |

The existing default patch uses square-wave keys and saw bass. Those have deliberate harmonic buzz; a clean signal path does not make them sine waves. Cold Start is the softer comparison preset. User-authored patterns and existing stored settings are preserved rather than silently replaced.

## What is still missing, in priority order

1. **Count-in and bar-aligned takes.** Visual capture starts on pointer-down and commits on release. Microphone capture starts manually, then the saved take plays from phrase bar one. Add a metronome/count-in, a clear loop boundary, and vocal trim/start-offset controls. Otherwise a good vocal performance can still enter at the wrong musical moment.
2. **Optional key/scale snapping.** Key and scale currently shape newly built grooves; canvas pitches are chromatic MIDI 48–84. A performer can accidentally leave the chosen harmony. Offer scale snapping with an explicit chromatic mode, rather than silently assuming every note is in key.
3. **Expression playback.** Visual takes keep notes and the final waveform; intermediate timbre movement, continuous pitch glides and expression/velocity gestures are not recorded. Add an automation lane if playback should reproduce the full performance.
4. **A finished audio recording.** Set JSON saves scenes and attached vocals. It is not a rendered WAV of the full mix. Add a clearly named Record/export mix action for an audio file that can be shared or used in a DAW.
5. **One coherent song save.** Music project, set, vocal take and visual library currently have separate storage/export paths; synth FX do not travel in a set scene. A unified project or explicit save overview would reduce the chance of losing part of a performance.

The next useful musical workflow is: choose a sketch/key → hear a clean loop → arm a take → count in → perform in the loop → replay/undo → trim/align vocals → arrange scenes → export the complete song and a WAV. The count-in, optional snapping and full-mix export are recommendations, not implemented features in this follow-up.

## Evidence and limits

The five-second default-score measurement before the fix had a pre-shaper peak of 3.017 and final peak of .293. With the bypass fix its final peak is .723 and its render matches the explicit bypass reference (relative error about 8.15e-8). All are finite and below full scale at the output; the old test for a bounded final output alone therefore missed the internal distortion. These measurements do not prove that every harsh sound heard by a user has the same cause.

Validation: 108 unit tests; TypeScript and production build; 14 real OfflineAudioContext checks; 13 existing UI checks; 13 production-preview interaction groups including note-recording states, positive Undo, unchanged mix FX while dragging, live play without recording, microphone capture, vocal FX, drag/touch arrangement, export/import and permission-policy guidance. Musical sound quality still needs human listening, and the intended mobile browsers should be tested with a real microphone.

Technical handoff: synth/vocal zero-drive bypass is in `src/core/audio/engine.ts`; gesture recording/feedback is in `src/ui/app.ts`; held note consolidation is in `src/core/performance/gesture.ts`. The existing WordPress microphone permission requirement remains unchanged. No production WordPress edits or deployment occur in this PR.
