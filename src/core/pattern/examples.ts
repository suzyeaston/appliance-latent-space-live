/** Three original patterns written for this prototype. Nothing here is sampled or borrowed. */

export interface PatternExample {
  id: string;
  title: string;
  blurb: string;
  source: string;
}

const COLD_START = `# Cold Start — sparse ambient
# Long tones over a two-bar bass drift. Turn memory up and let the trails smear.
tempo 58
bars 4
grid 8

voice drift tone
  wave triangle
  level 0.5
  play a4  _  _  _  .  .  .  .
  play .   .  e4 _  _  _  .  .
  play c5  _  _  _  _  .  .  .
  play .   .  .  b4 _  _  _  .

voice under bass
  wave sine
  level 0.7
  play a1 _ _ _ _ _ _ _ | f1 _ _ _ _ _ _ _

voice pulse perc
  level 0.4
  play . . hat@0.3 . . . hat@0.2 .
`;

const SERVICE_ELEVATOR = `# Service Elevator — rhythmic
# Two bars of sixteenths. Bass and drums hold the floor, the keys lean late.
tempo 104
bars 2
grid 16

voice keys tone
  wave square
  level 0.55
  play [a3 c4 e4]@0.75 _ . . e4@0.6 . . g4@0.55 . . [a3 c4 e4]@0.6 _ . b3@0.5 . .
  play [f3 a3 c4]@0.75 _ . . c4@0.6 . . a3@0.5 . e4@0.6 . . [g3 b3 d4]@0.6 _ . .

voice low bass
  wave saw
  level 0.8
  play a1 . a1@0.5 . . a2@0.6 . . a1 . . a1@0.5 . . g1@0.7 .
  play f1 . f1@0.5 . . f2@0.6 . . f1 . . c2@0.5 . . c2@0.7 .

voice drums perc
  level 0.7
  play kick . . hat@0.4 . . kick@0.7 . snare . . hat@0.4 . kick@0.5 hat@0.3 rim@0.4
  play kick . . hat@0.4 . rim@0.3 kick@0.7 . snare . hat@0.3 . . kick@0.5 . snare@0.4
`;

const ELEMENT_FAILURE = `# Element Failure — experimental texture
# Three bars of twelves, so nothing lands where a four-square bar would put it.
# Push destruction past 0.5 and the low voice starts to tear.
tempo 76
bars 3
grid 12

voice shard tone
  wave saw
  octave 1
  level 0.4
  play c4@0.8 . . f#4@0.4 _ . . . b3@0.6 . . .
  play . [c4 f#4]@0.5 _ . . g3@0.7 . . . . eb4@0.45 .
  play a4@0.3 . c5@0.35 . . . . f#4@0.5 _ _ . .

voice rumble bass
  wave triangle
  level 0.75
  play c1 _ _ . . . c1@0.4 _ . . . .

voice static perc
  level 0.5
  play hat@0.2 . rim@0.3 . hat@0.15 . . kick@0.6 . . hat@0.25 .
  play . kick@0.5 . hat@0.2 . . rim@0.35 . hat@0.2 . . snare@0.3
  play kick@0.55 . . . hat@0.3 . rim@0.2 . . snare@0.25 . hat@0.15
`;

export const EXAMPLES: PatternExample[] = [
  {
    id: 'service-elevator',
    title: 'Service Elevator',
    blurb: 'Rhythmic. Sixteenths, two bars, all three voice kinds working.',
    source: SERVICE_ELEVATOR,
  },
  {
    id: 'cold-start',
    title: 'Cold Start',
    blurb: 'Sparse ambient. Long tones, slow bass drift, almost no percussion.',
    source: COLD_START,
  },
  {
    id: 'element-failure',
    title: 'Element Failure',
    blurb: 'Experimental. A twelve-step grid, chords that do not resolve, room for destruction.',
    source: ELEMENT_FAILURE,
  },
];

export const DEFAULT_EXAMPLE_ID = 'service-elevator';

export function exampleById(id: string): PatternExample | null {
  return EXAMPLES.find((example) => example.id === id) ?? null;
}

export function defaultExample(): PatternExample {
  return exampleById(DEFAULT_EXAMPLE_ID) ?? (EXAMPLES[0] as PatternExample);
}
