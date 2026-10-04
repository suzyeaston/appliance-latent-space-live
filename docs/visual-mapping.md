# Visual mapping

The visualizer now has a **musical grammar**, not just a decorative particle system.
The picture is still derived from scheduled musical events and the audio clock.

## Default: musical field

The circular field is a score wrapped around a clock:

| music | picture |
| --- | --- |
| position in the loop | angle around the field; 12 o'clock is the loop start |
| pitch | radius; low notes live closer to the core, high notes farther out |
| duration | arc length; held notes paint longer arcs |
| velocity | stroke weight and node size |
| voice | hue family, with bass and percussion offset from tonal voices |
| percussion | semantic glyphs: kick circle, snare diamond, hat cross, rim stroke |
| tempo | the central pulse is locked to the beat, so faster music visibly breathes faster |
| swing | off-grid events receive a small angular delay that mirrors the musical timing |
| audio energy | brightness only; energy never moves a note away from its scored position |
| memory | how long traces remain, shared with delay feedback |

The visualizer also derives a **musical dialect**. A groove generated from the DJ controls
keeps its explicit style tag when available; hand-authored patterns are classified from tempo,
sustain, syncopation, percussion and four-on-the-floor strength.

- **House → clock**: strict radial beat geometry and four cardinal beat rays.
- **Broken beat → fracture**: angular discontinuities and syncopated segmented arcs.
- **Dub → echo**: several concentric copies, slow radial depth and long persistence.
- **Ambient → nebula**: wide elliptical arcs, long sustain and soft contour motion.
- **Electro → circuit**: polygonal geometry and harder stepped edges.
- **Free → hybrid**: neutral score field when the music does not strongly match a preset.

The canvas labels its current dialect, BPM and mapping, so the visual language is legible while performing.

## Linear score mode

The existing **Orbit** design control is no longer an on/off switch between "meaning" and "pretty".
At almost zero it intentionally enters a linear score view:

- x = loop time
- y = pitch
- trail length = duration
- percussion = lanes below the pitch field

Above that threshold, Orbit becomes a curvature/shape modifier inside the musical field.

`visual intensity` scales brightness and stroke weight. `Reduce motion` removes decorative drift
and shrinks pulse motion without changing note placement. There is no flashing.
