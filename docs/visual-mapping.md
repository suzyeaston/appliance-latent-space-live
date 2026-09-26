# Visual mapping

The picture is the score, drawn against the audio clock. Frame rate does not move notes.

| music | picture |
| --- | --- |
| position in the loop | horizontal position. The left edge is bar 1, beat 1. |
| pitch | vertical position. MIDI 24 sits at the floor of the pitch field, MIDI 96 at the ceiling. |
| duration | trail length. A held note keeps being drawn for as long as it sounds. |
| voice | colour. Tonal voices are icy blue, bass is violet, percussion is a paler blue, and a second voice of the same kind shifts hue slightly. |
| attack | a ring at the start of the note, larger when the note is louder. |
| percussion | its own lanes under the pitch field, in the order kick, snare, rim, hat. |
| audio energy | brightness of what is already drawn, read from an analyser on the master output. |
| memory | how slowly the frame fades, which is how long traces remain. The same control also sets the delay feedback. Both scopes are labelled on the control. |

Bar lines are faint verticals. A playhead marks where the loop is now.

Energy never decides where a note is. A quiet note is still exactly where the pattern put it.

`visual intensity` scales pulse size, line thickness and the scanline drift. `Reduce motion` removes the drift and the pitch wobble and shrinks the attack rings. The operating system's reduced-motion setting starts the instrument in that mode on a fresh visit.

There is no flashing. The brightest motion is the playhead and the attack rings.
