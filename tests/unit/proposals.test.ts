import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/core/pattern/parse';
import { EXAMPLES, defaultExample } from '../../src/core/pattern/examples';
import { variationProvider } from '../../src/core/proposals/variation';

async function propose(pattern: string, seed: number) {
  const outcome = await variationProvider.propose({ pattern, seed });
  return outcome;
}

describe('the variation provider', () => {
  it('is not an AI and does not use the network', () => {
    expect(variationProvider.label).toBe('Variation');
    expect(variationProvider.usesNetwork).toBe(false);
    expect(variationProvider.description.toLowerCase()).toContain('no model');
  });

  it('returns a candidate that passes the same parser as a human pattern', async () => {
    for (const example of EXAMPLES) {
      const outcome = await propose(example.source, 7);
      expect(outcome.ok, `${example.title} produced no proposal`).toBe(true);
      if (!outcome.ok) continue;
      const parsed = parsePattern(outcome.proposal.pattern);
      expect(parsed.ok, `${example.title} variation did not parse`).toBe(true);
    }
  });

  it('is deterministic for a given seed and differs across seeds', async () => {
    const source = defaultExample().source;
    const first = await propose(source, 3);
    const again = await propose(source, 3);
    const other = await propose(source, 4);
    expect(first.ok && again.ok && other.ok).toBe(true);
    if (!first.ok || !again.ok || !other.ok) return;
    expect(again.proposal.pattern).toBe(first.proposal.pattern);
    expect(other.proposal.pattern).not.toBe(first.proposal.pattern);
  });

  it('leaves the bass alone', async () => {
    const source = defaultExample().source;
    const before = parsePattern(source);
    const outcome = await propose(source, 11);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !before.ok) return;
    const after = parsePattern(outcome.proposal.pattern);
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    const bassOf = (score: typeof before.score): unknown[] => {
      const index = score.voices.findIndex((voice) => voice.kind === 'bass');
      return score.events
        .filter((event) => event.voice === index)
        .map((event) => ({ step: event.step, steps: event.steps, pitches: event.pitches }));
    };
    expect(bassOf(after.score)).toEqual(bassOf(before.score));
  });

  it('keeps tempo, grid and loop length', async () => {
    const before = parsePattern(defaultExample().source);
    const outcome = await propose(defaultExample().source, 5);
    if (!outcome.ok || !before.ok) throw new Error('expected a proposal');
    const after = parsePattern(outcome.proposal.pattern);
    if (!after.ok) throw new Error('expected valid output');
    expect(after.score.tempo).toBe(before.score.tempo);
    expect(after.score.grid).toBe(before.score.grid);
    expect(after.score.bars).toBe(before.score.bars);
  });

  it('refuses to work from an invalid pattern', async () => {
    const outcome = await propose('tempo 90\nbars 1\ngrid 4\nvoice a tone\n  play h9 . . .', 1);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('valid');
  });

  it('explains what it changed', async () => {
    const outcome = await propose(defaultExample().source, 9);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.proposal.notes.length).toBeGreaterThan(0);
    expect(outcome.proposal.label).toContain('Variation');
    expect(outcome.proposal.notes.join(' ')).toContain('Bass');
  });

  it('never produces an empty proposal across many seeds', async () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const outcome = await propose(defaultExample().source, seed);
      if (!outcome.ok) {
        expect(outcome.reason).toContain('seed');
        continue;
      }
      const parsed = parsePattern(outcome.proposal.pattern);
      expect(parsed.ok, `seed ${seed} produced an invalid pattern`).toBe(true);
    }
  });
});
