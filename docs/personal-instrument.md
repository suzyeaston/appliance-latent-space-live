# Personal instrument — study 0.2

## Play
Start enables audio. Try a sketch, set tempo, and adjust individual voice levels.
Browning controls tone, destruction adds drive, memory adds delay. Valid code changes
apply at a bar line. Invalid code keeps the last valid music. Stop and Kill retain
existing semantics. Performance view enlarges the stage; Escape exits.
Tempo and mixer edits format the pattern, so custom comments are not retained by those
edits. Export your project before using them if comments matter.

## Teach the visual instrument
1. Play your phrase. Choose colour, orbit/thread geometry, spread, movement and afterglow.
2. Name the study and press Teach this pairing.
3. Change the musical phrase, tempo or tone settings. Design a different visual response.
4. After three distinct musical settings, press Train visual instrument.
5. Follow my trained examples applies the model to new musical settings. Moving a look
   slider returns to design mode. Teach more examples and retrain to expand the mapping.

The model is instance-based regression using the three nearest saved feature vectors,
with inverse-distance weighting and circular hue interpolation. No pretrained weights,
external AI service, images, recordings or training examples ship with the app. The
procedural renderer is authored code. Only its visual parameters are learned from your
paired examples. This is not an image generator, audio encoder or neural latent space.
Its inputs describe the whole currently playing pattern (tempo, event density, average
pitch, effective velocity, duration and percussion fraction), plus tone controls.
Scheduled notes and measured audio energy animate the geometry. A quiet outline is
visible before playback; it does not pretend audio is active.

The local visual library stores features, labels and model examples, not raw recordings.
It is separate from music project JSON. Export both. Visitors start with empty libraries;
Suzy's trained visual identity is not automatically published to other visitors. A later
explicit publish workflow can bundle an approved export. Browser storage is not a backup.
Teaching changes do not affect an existing trained model until retraining. Imported files
are schema validated, bounded to 128 examples per set, and capped at 1 MB.

## Next sound-model milestone
Collect original isolated bass, voice, household textures and gestures with recording
provenance and usage permission. Keep raw recordings outside the public source repository.
Evaluate a small audio model trained from scratch on that corpus before claiming neural
sound or enabling the reserved latent controls. A separate later study can learn phrasing.
Do not substitute a pretrained music generator without explaining its inherited influences.

## Technical handoff
Added Studio UI, local visual regression, note-driven constellation drawing, musical
controls and accessible range names. Existing sound graph, project schema and control-map
IDs remain. The disabled sound latent group is collapsed. Relative build paths remain.
No WordPress theme change is required because the existing iframe loads the Pages app.
Use the full instrument link to avoid the embed's fixed-height scrolling.

Validation: unit suite and TypeScript/production build. The remote browser disallowed local
preview access, so this revision still needs a Chrome interaction and listening pass on
Suzy's Mac before publication. The updater opens a local preview before its publish prompt.
