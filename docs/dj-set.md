# Live set 0.3

Choose a key (12 roots), scale (major, natural minor, Dorian or minor pentatonic),
style (house, broken beat, dub, ambient or electro), rhythm, density and swing.
Build / queue groove replaces the current phrase with a four-bar original rule-based
sketch. These are musical starting points, not samples or learned musical styles.
Keep current tempo defaults on; turn it off to use the new groove BPM or a saved
scene's original tempo.

Swap drums only preserves the current pitched voices, loop length and tempo, then
replaces percussion with independent kick, snare and hat lanes. Rhythm positions
adapt to the current grid. Up to five melodic voices leave room for those three lanes.
Transpose ±1 moves existing notes one semitone, leaving percussion unchanged. It
does not estimate a phrase's key. The key/scale selectors apply to newly built grooves.
Apply swing adjusts the current pattern. Drum breakdown mutes percussion; Undo DJ
change restores the preceding phrase. A session keeps up to 20 DJ undo steps.

Four scene slots hold editable musical patterns (including swing and tempo).
Save captures the editor, including any queued change. Launch queues a scene at the
next bar line while playing, or loads it immediately while stopped. This is a single
live instrument with scene switching, not simultaneous audio decks or a crossfader.
It preserves the sequencer's current bar position within the new loop. Already
sounding notes/effect tails may overlap a transition. Start is still a user gesture.

Export set saves all four slots. Import validates each pattern, limits file size and
asks before replacing a nonempty set. Sets are local to this browser/origin and
separate from visual libraries, effects and music project exports. Keep backups.

Swing is now a pattern directive: `swing 0.2` delays odd grid subdivisions by 20%
of a step and adjusts note durations, retaining bar length. Range: 0–0.45. Omission
means straight timing. On odd grids, the final unpaired subdivision stays straight.
All existing pattern files remain readable. Music project JSON preserves swing
inside the pattern text without a project schema change.

Validation: 95 unit tests, including every key/scale/style/rhythm combination,
drum-preservation checks, pitch limits, saved-set validation, and measured scheduler
swing timing. TypeScript and production build pass. Browser interaction and human
listening remain for the Mac preview; remote local-preview access was unavailable.
The updater supports both the original public build and the preceding Study 0.2.
No repository or website was pushed during preparation.
