import { describe, expect, it } from 'vitest';
import { layoutNote, memoryFade, pitchY, voiceHue } from '../../src/core/visual/renderer';

const SIZE = { width: 800, height: 400 };

describe('note layout follows the score', () => {
  const base = {
    voice: 0,
    kind: 'tone' as const,
    pitches: [60],
    loopStep: 0,
    steps: 1,
    totalSteps: 16,
  };

  it('puts a higher pitch above a lower one', () => {
    const low = layoutNote({ ...base, pitches: [36] }, SIZE.width, SIZE.height);
    const high = layoutNote({ ...base, pitches: [84] }, SIZE.width, SIZE.height);
    expect(high.y).toBeLessThan(low.y);
  });

  it('puts a later step further to the right', () => {
    const early = layoutNote(base, SIZE.width, SIZE.height);
    const late = layoutNote({ ...base, loopStep: 8 }, SIZE.width, SIZE.height);
    expect(late.x).toBeGreaterThan(early.x);
    expect(late.x).toBeCloseTo(SIZE.width / 2);
  });

  it('gives a held note a longer trail than a short one', () => {
    const short = layoutNote(base, SIZE.width, SIZE.height);
    const held = layoutNote({ ...base, steps: 6 }, SIZE.width, SIZE.height);
    expect(held.length).toBeGreaterThan(short.length * 4);
  });

  it('gives each voice kind its own hue', () => {
    const tone = voiceHue('tone', 0);
    const bass = voiceHue('bass', 0);
    const perc = voiceHue('perc', 0);
    expect(new Set([tone, bass, perc]).size).toBe(3);
    expect(bass).toBeGreaterThan(tone);
  });

  it('keeps percussion below the pitch field', () => {
    const lowestPitch = pitchY(24, SIZE.height);
    const kick = layoutNote({ ...base, kind: 'perc', hit: 'kick', pitches: [] }, SIZE.width, SIZE.height);
    expect(kick.y).toBeGreaterThan(lowestPitch);
  });

  it('keeps memory persistence inside a visible range', () => {
    expect(memoryFade(0)).toBeGreaterThan(memoryFade(1));
    expect(memoryFade(0)).toBeLessThan(1);
    expect(memoryFade(1)).toBeGreaterThan(0);
    expect(memoryFade(99)).toBe(memoryFade(1));
  });
});
