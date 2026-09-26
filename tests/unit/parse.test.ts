import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/core/pattern/parse';
import { formatScore } from '../../src/core/pattern/format';
import { EXAMPLES } from '../../src/core/pattern/examples';
import type { PatternIssue, Score } from '../../src/core/pattern/types';

function ok(source: string): Score {
  const result = parsePattern(source);
  if (!result.ok) {
    throw new Error(`expected a valid pattern, got: ${result.errors.map((e) => e.message).join(' | ')}`);
  }
  return result.score;
}

function errors(source: string): PatternIssue[] {
  const result = parsePattern(source);
  if (result.ok) throw new Error('expected this pattern to be rejected');
  return result.errors;
}

const MINIMAL = `tempo 90
bars 1
grid 4
voice lead tone
  play c4 . e4 .
`;

describe('the pattern language', () => {
  it('reads a minimal pattern', () => {
    const score = ok(MINIMAL);
    expect(score.tempo).toBe(90);
    expect(score.bars).toBe(1);
    expect(score.grid).toBe(4);
    expect(score.totalSteps).toBe(4);
    expect(score.voices).toHaveLength(1);
    expect(score.events).toHaveLength(2);
    expect(score.events[0]).toMatchObject({ step: 0, steps: 1, pitches: [60], velocity: 0.85 });
    expect(score.events[1]).toMatchObject({ step: 2, pitches: [64] });
  });

  it('turns ties into duration and rests into silence', () => {
    const score = ok(`tempo 90
bars 1
grid 8
voice lead tone
  play c4 _ _ . e4 _ . .
`);
    expect(score.events.map((event) => [event.step, event.steps])).toEqual([
      [0, 3],
      [4, 2],
    ]);
  });

  it('reads accidentals, octaves, chords and velocities', () => {
    const score = ok(`tempo 90
bars 1
grid 4
voice lead tone
  play [c4 eb4 g4]@0.4 . f#5 bb2
`);
    expect(score.events[0]?.pitches).toEqual([60, 63, 67]);
    expect(score.events[0]?.velocity).toBe(0.4);
    expect(score.events[1]?.pitches).toEqual([78]);
    expect(score.events[2]?.pitches).toEqual([46]);
  });

  it('applies an octave shift at parse time', () => {
    const score = ok(`tempo 90
bars 1
grid 2
voice lead tone
  octave -1
  play c4 c4
`);
    expect(score.events[0]?.pitches).toEqual([48]);
  });

  it('repeats a short voice across a longer loop', () => {
    const score = ok(`tempo 90
bars 4
grid 4
voice lead tone
  play c4 . . .
voice low bass
  play c2 . . . | g1 . . .
`);
    const lead = score.events.filter((event) => event.voice === 0);
    const low = score.events.filter((event) => event.voice === 1);
    expect(lead.map((event) => event.step)).toEqual([0, 4, 8, 12]);
    expect(low.map((event) => event.step)).toEqual([0, 4, 8, 12]);
    expect(low.map((event) => event.pitches[0])).toEqual([36, 31, 36, 31]);
  });

  it('accepts percussion names only in percussion voices', () => {
    const score = ok(`tempo 90
bars 1
grid 4
voice drums perc
  play kick . snare hat@0.3
`);
    expect(score.events.map((event) => event.hit)).toEqual(['kick', 'snare', 'hat']);
    expect(errors(`tempo 90
bars 1
grid 4
voice drums perc
  play kick . c4 .
`)[0]?.message).toContain('not a percussion sound');
    expect(errors(`tempo 90
bars 1
grid 4
voice lead tone
  play kick . c4 .
`)[0]?.message).toContain('percussion sound');
  });

  it('ignores comments and blank lines', () => {
    const score = ok(`# a title
tempo 90   # inline
bars 1

grid 2
voice lead tone
  play c4 .   # trailing
`);
    expect(score.events).toHaveLength(1);
  });

  it('does not mistake a sharp for a comment', () => {
    expect(ok(`tempo 90
bars 1
grid 2
voice lead tone
  play f#4 .
`).events[0]?.pitches).toEqual([66]);
  });
});

describe('validation errors point at the problem', () => {
  it('reports a bar with the wrong number of steps', () => {
    const issues = errors(`tempo 90
bars 1
grid 8
voice lead tone
  play c4 . e4 .
`);
    expect(issues[0]?.message).toContain('has 4 steps, but grid is 8');
    expect(issues[0]?.line).toBe(5);
    expect(issues[0]?.column).toBeGreaterThan(1);
  });

  it('reports an unreadable note with its column', () => {
    const issues = errors(`tempo 90
bars 1
grid 4
voice lead tone
  play c4 . h9 .
`);
    expect(issues[0]?.message).toContain('"h9" is not a note');
    expect(issues[0]?.line).toBe(5);
    expect(issues[0]?.column).toBe(13);
    expect(issues[0]?.length).toBe(2);
  });

  it('reports missing headers', () => {
    const messages = errors(`voice lead tone
  play c4
`).map((issue) => issue.message);
    expect(messages).toContain('Missing "tempo".');
    expect(messages).toContain('Missing "bars".');
    expect(messages).toContain('Missing "grid".');
  });

  it('rejects out-of-range headers', () => {
    expect(errors(`tempo 900
bars 1
grid 4
voice a tone
  play c4 . . .
`)[0]?.message).toContain('tempo must be between');
    expect(errors(`tempo 90
bars 99
grid 4
voice a tone
  play c4 . . .
`)[0]?.message).toContain('bars must be between');
  });

  it('rejects unknown instructions, kinds and waves', () => {
    expect(errors(`tempo 90
bars 1
grid 4
reverb 0.5
voice a tone
  play c4 . . .
`)[0]?.message).toContain('Unknown instruction "reverb"');
    expect(errors(`tempo 90
bars 1
grid 4
voice a kazoo
  play c4 . . .
`)[0]?.message).toContain('Unknown voice kind');
    expect(errors(`tempo 90
bars 1
grid 4
voice a tone
  wave chainsaw
  play c4 . . .
`)[0]?.message).toContain('Unknown wave');
  });

  it('rejects a voice setting outside a voice', () => {
    expect(errors(`tempo 90
bars 1
grid 4
level 0.5
voice a tone
  play c4 . . .
`)[0]?.message).toContain('belongs inside a voice');
  });

  it('rejects duplicate voices, duplicate settings and bad levels', () => {
    expect(errors(`tempo 90
bars 1
grid 4
voice a tone
  play c4 . . .
voice a tone
  play c4 . . .
`)[0]?.message).toContain('declared twice');
    expect(errors(`tempo 90
bars 1
grid 4
voice a tone
  level 0.5
  level 0.6
  play c4 . . .
`)[0]?.message).toContain('is set twice');
    expect(errors(`tempo 90
bars 1
grid 4
voice a tone
  level 9
  play c4 . . .
`)[0]?.message).toContain('level must be a number between 0 and 1');
  });

  it('rejects a voice whose bar count does not divide the loop', () => {
    expect(errors(`tempo 90
bars 4
grid 2
voice a tone
  play c4 . | e4 . | g4 .
`)[0]?.message).toContain('does not divide');
  });

  it('rejects an oversized chord and an unclosed one', () => {
    expect(errors(`tempo 90
bars 1
grid 2
voice a tone
  play [c4 e4 g4 b4 d5] .
`)[0]?.message).toContain('at most 4 notes');
    expect(errors(`tempo 90
bars 1
grid 2
voice a tone
  play [c4 e4 .
`)[0]?.message).toContain('close with "]"');
  });

  it('rejects a voice with no play line and a pattern with no voices', () => {
    expect(errors(`tempo 90
bars 1
grid 4
voice a tone
  level 0.5
`)[0]?.message).toContain('has no "play" line');
    expect(errors(`tempo 90
bars 1
grid 4
`)[0]?.message).toContain('No voices');
  });

  it('rejects a percussion voice that asks for a waveform', () => {
    expect(errors(`tempo 90
bars 1
grid 4
voice d perc
  wave saw
  play kick . . .
`)[0]?.message).toContain('synthesize their own sounds');
  });

  it('rejects a velocity outside 0..1', () => {
    expect(errors(`tempo 90
bars 1
grid 2
voice a tone
  play c4@3 .
`)[0]?.message).toContain('unreadable velocity');
  });

  it('warns rather than fails when a tie has nothing to hold', () => {
    const result = parsePattern(`tempo 90
bars 1
grid 4
voice a tone
  play _ c4 . .
`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings[0]?.message).toContain('nothing to hold');
      expect(result.score.events).toHaveLength(1);
    }
  });

  it('refuses a loop with an implausible number of notes', () => {
    const bar = new Array(32).fill('c4').join(' ');
    const voices = new Array(8)
      .fill(0)
      .map((_, index) => `voice v${index} tone\n  play ${new Array(16).fill(bar).join(' | ')}`)
      .join('\n');
    const issues = errors(`tempo 90\nbars 16\ngrid 32\n${voices}\n`);
    expect(issues[0]?.message).toContain('note ceiling');
  });
});

describe('the shipped examples', () => {
  EXAMPLES.forEach((example) => {
    it(`"${example.title}" parses and uses all three voice kinds`, () => {
      const score = ok(example.source);
      const kinds = new Set(score.voices.map((voice) => voice.kind));
      expect(kinds).toEqual(new Set(['tone', 'bass', 'perc']));
      expect(score.events.length).toBeGreaterThan(8);
      expect(parsePattern(example.source).ok).toBe(true);
    });

    it(`"${example.title}" survives a print and re-parse round trip`, () => {
      const first = ok(example.source);
      const second = ok(formatScore(first));
      expect(second.tempo).toBe(first.tempo);
      expect(second.bars).toBe(first.bars);
      expect(second.grid).toBe(first.grid);
      const musical = (score: Score): unknown[] =>
        score.events.map(({ line: _line, ...rest }) => rest);
      expect(musical(second)).toEqual(musical(first));
    });
  });

  it('has no duplicate example ids', () => {
    expect(new Set(EXAMPLES.map((example) => example.id)).size).toBe(EXAMPLES.length);
  });
});
