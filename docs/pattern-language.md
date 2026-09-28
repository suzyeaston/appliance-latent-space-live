# Pattern language

A pattern is plain text. The instrument reads it. It never runs it. There is no JavaScript in a pattern, and nothing you paste into the editor can reach outside the parser.

## A voice in one look

```text
tempo 96
bars 2
grid 8

voice lead tone
  wave triangle
  level 0.6
  play c4 . e4 _ | g4 . . .
```

`tempo` is beats per minute, from 20 to 300. `bars` is the loop length, from 1 to 16. `grid` is how many steps fit in one bar of 4/4. `grid 8` is eighth notes. `grid 16` is sixteenths.

## Steps

Each token in a `play` line is one step.

| token | meaning |
| --- | --- |
| `c4` | a note. Letter, optional `#` or `b`, then an octave. `c4` is middle C. |
| `.` | a rest |
| `_` | hold the previous note for one more step |
| `c4@0.4` | the same note, quieter. Velocity runs from 0 to 1. The default is 0.85. |
| `[c4 e4 g4]` | a chord, up to four notes |
| `\|` | end of a bar. Every bar must contain exactly `grid` steps. |

A `#` starts a comment when it follows a space or begins a line. `f#4` is still F sharp.

## Voices

```text
voice <name> <kind>
```

`kind` is one of `tone`, `bass` or `perc`. A pattern needs at least one voice and can have up to eight.

| line | what it does |
| --- | --- |
| `wave sine` | `sine`, `triangle`, `square` or `saw`. Not used on percussion. |
| `level 0.7` | 0 is silent, 1 is full, for this voice only. |
| `octave -1` | shifts every note in the voice, from -3 to 3. |
| `mute` | the voice is parsed and drawn faintly, and it does not sound. |
| `play ...` | the notes. One voice may have several `play` lines. |

A voice that writes fewer bars than the loop repeats, provided its bar count divides the loop. A 1-bar bass under a 4-bar melody is the usual case. A 3-bar phrase in a 4-bar loop is an error, and the message says so.

Percussion voices use `kick`, `snare`, `hat` and `rim` instead of notes. A hit does not hold across `_`; the sound has its own decay.

## When an edit takes effect

While the loop is stopped, a valid edit replaces the pattern immediately. While it is playing, a valid edit waits for the next bar line. The tag above the editor says which pattern is sounding and whether an edit is waiting.

An invalid edit does not replace anything. The last valid pattern keeps playing, and the error names a line and a column. Click the error to land on it.

## The three examples

| title | what to listen for |
| --- | --- |
| Service Elevator | the default. Two bars of sixteenths. Keys, bass and drums all working. |
| Cold Start | long tones, a slow bass drift, almost no percussion. Turn memory up. |
| Element Failure | a twelve-step grid, so accents do not land on a square bar. Room for destruction. |

## Swing

Optional `swing 0.2` delays odd grid subdivisions by 20% of one step. Range 0–0.45; default zero. Bar length is unchanged. On odd grids the final unpaired subdivision stays straight.
