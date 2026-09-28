# Timeline 0.4

See [timeline.md](timeline.md) for current layout, playback behavior, saved-set format and validation.

# Layout update

Moved the DJ music controls above the visualization in DOM order; moved project introduction below the workspace. Start/Stop and quick mixer remain at the top. Renamed the desk “Change the music.” No audio, scene or training behavior changed.

# Live set 0.3

See [dj-set.md](dj-set.md) for performance controls, scene storage, swing, tests and limitations.

# Study 0.2 update

See [personal-instrument.md](personal-instrument.md) for current implementation, training scope, and validation limitations. The sections below document the earlier 0.1 snapshot.

# Technical handoff

Prototype 0.1, received as the main-branch ZIP with archive commit c865a7185fb80a8a92b13886589067456a854315. The previous feature-branch status below was historical; current remote state was not accessible.

## Public launch preparation — September 26, 2026

Preserved the instrument implementation. Added Basecamp/project links, relative Vite base paths, portable Chrome detection, fresh-repository setup, deployment scripts, and WordPress embed instructions. Replaced obsolete private-only setup instructions following Suzy's explicit public-launch request.

Run the delivered setup script to create the public remote and start its Pages build. No remote publication occurred while preparing this package. Runtime validation results belong in the setup output. The remaining roadmap is still Web MIDI, sound design and eventual actual model integration.

## Validation of launch preparation

- 84 unit tests pass, including a clean installation and build using Node 22.
- Browser smoke checks pass for Start, note-driven canvas visuals, invalid edits preserving playback, Kill and example changes.
- Nine rendered Web Audio checks pass in headless Chromium: timing, silence, mute, Kill, bounded output and tone change. This is measurement, not human listening.
- Self-extracting launcher, remote creation, source push, gh-pages publication, Pages configuration, resume and repeat deployment were exercised using real local Git repositories and a simulated GitHub CLI. No user remote was changed during testing.
- Dirty checkouts, unexpected remotes and existing unrelated destination folders are refused.
- Actual GitHub permissions, macOS device audio, and the live WordPress host still require runtime verification.

## What works

- A text pattern language with tempo, loop length, notes, rests, ties, chords, velocities, three voice kinds, per-voice level and mute, and errors that name a line and column.
- Look-ahead scheduling on the audio clock. Valid edits apply at the next bar line. Invalid edits leave the last valid pattern running.
- Synthesized tone, bass and percussion. No samples and no runtime network requests.
- `browning` (low-pass colour), `destruction` (bounded waveshaper), `memory` (capped delay feedback and visual persistence), `freeze`, `plunge`, `capture` and `kill`.
- `latent_x`, `latent_y` and `neural_mix` are visible and disabled. Nothing latent or neural is running.
- Local autosave, versioned JSON export and import, and a labelled Variation proposal that must be auditioned and accepted. Accept can be reverted.
- The control vocabulary and its MIDI assignments are the ones from suzyeastonca `control-map.json` (schema 0.1.0). That repository was not modified.

## What was tested

- `npm test`: parser, sequencer (including bar-boundary swaps, freeze, repeated start/stop), control map, project import, variation, audio parameter bounds, and the visual mapping. 84 tests, all passing at the time of this handoff.
- `npm run test:audio`: the real Web Audio graph rendered in headless Chrome through `OfflineAudioContext`. Checks timing, mute, kill, finite output under full destruction and memory, and that browning changes the signal. This is a measurement, not a listening test.
- `npm run build`: typecheck plus production bundle.
- A headed Chrome pass (`node tests/audio/ui-smoke.mjs`) against the production preview checked Start, the playing canvas, an invalid edit that left the last pattern running, Kill, and loading Cold Start. Screenshots of that pass were reviewed. The speakers were not heard. A screen recording was saved; the separate video-review model was unavailable, so the recording was not independently described.

## Assumptions that were not verified on Suzy's machine

- Behaviour under macOS headphones, including latency and whether the tab gets suspended.
- How the piece feels to play. The synth voices are a starting point, not a finished sound.
- The upstream control-map file was read from GitHub. It was not compared against a local unpushed checkout of suzyeastonca.

## Limitations

- No Web MIDI yet, though `resolveMidiBinding` already maps the upstream assignments.
- No toaster, no firmware, no model, no accounts, no sync.
- Variation is a seeded transform. It does not read an instruction such as "let the melody dissolve".
- Capture is a single slot in memory. It is not the project file.
- The master fader is capped at 0.7 linear gain, then tapered, and a limiter follows it.

## Recommended next milestone

Web MIDI input, using the bindings already in the control map, behind the same control events the sliders emit. Feature-detect `requestMIDIAccess` and keep working when it is refused. That is the step the toaster will eventually speak, and it does not require the toaster, a model, or any new service.
