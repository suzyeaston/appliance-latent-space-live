import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/core/pattern/parse';
import type { Score } from '../../src/core/pattern/types';
import { Sequencer, type BarEvent, type ScheduledNote } from '../../src/core/sequencer';

function score(source: string): Score {
  const result = parsePattern(source);
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.message).join(' | '));
  return result.score;
}

/** 120 bpm, grid 4 means one step is 0.5s and one bar is 2s. Easy arithmetic on purpose. */
const A = score(`tempo 120
bars 2
grid 4
voice lead tone
  play c4 . . . | e4 . . .
`);

const B = score(`tempo 120
bars 2
grid 4
voice lead tone
  play g4 . . . | b4 . . .
`);

interface Harness {
  sequencer: Sequencer;
  notes: ScheduledNote[];
  bars: BarEvent[];
  /** Clock reading at the moment each note was handed over, index-aligned with `notes`. */
  emittedAt: number[];
  advance(seconds: number): void;
  clock(): number;
}

function harness(initial: Score = A, lookahead = 0.25): Harness {
  let time = 0;
  const notes: ScheduledNote[] = [];
  const emittedAt: number[] = [];
  const bars: BarEvent[] = [];
  const sequencer = new Sequencer(initial, {
    now: () => time,
    onNotes: (batch) => {
      batch.forEach(() => emittedAt.push(time));
      notes.push(...batch);
    },
    onBar: (bar) => bars.push(bar),
    lookahead,
  });
  return {
    sequencer,
    notes,
    emittedAt,
    bars,
    clock: () => time,
    advance(seconds: number) {
      // Tick on a 40 ms interval, exactly like the application does.
      const steps = Math.round(seconds / 0.04);
      for (let i = 0; i < steps; i += 1) {
        time = Number((time + 0.04).toFixed(6));
        sequencer.tick();
      }
    },
  };
}

describe('scheduling', () => {
  it('does nothing until it is started', () => {
    const h = harness();
    h.advance(2);
    expect(h.notes).toHaveLength(0);
    expect(h.sequencer.isRunning).toBe(false);
  });

  it('schedules notes ahead of the clock, in musical order', () => {
    const h = harness();
    h.sequencer.start(0);
    // Two bars of 2 seconds each, one attack per bar, so six seconds is four attacks.
    h.advance(6.2);
    expect(h.notes.length).toBe(4);
    const times = h.notes.map((note) => note.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // First two attacks are a bar apart: 2 seconds at 120 bpm.
    expect((h.notes[1]?.time ?? 0) - (h.notes[0]?.time ?? 0)).toBeCloseTo(2, 6);
    // Every note was handed over before it was due, and never more than the look-ahead early.
    h.notes.forEach((note, index) => {
      const handedOver = h.emittedAt[index] as number;
      expect(note.time).toBeGreaterThan(handedOver);
      expect(note.time - handedOver).toBeLessThanOrEqual(0.3);
    });
  });

  it('gives every note a duration in seconds taken from its written length', () => {
    const held = score(`tempo 120
bars 1
grid 4
voice lead tone
  play c4 _ _ .
`);
    const h = harness(held);
    h.sequencer.start(0);
    h.advance(1);
    expect(h.notes[0]?.duration).toBeCloseTo(1.5, 6);
  });

  it('is idempotent across repeated starts and stops', () => {
    const h = harness();
    h.sequencer.start(0);
    h.sequencer.start(0);
    h.sequencer.start(0);
    h.advance(2.1);
    const first = h.notes.length;
    h.sequencer.stop();
    h.sequencer.stop();
    h.advance(2);
    expect(h.notes.length).toBe(first);
    expect(h.sequencer.isRunning).toBe(false);
    h.sequencer.start(h.clock());
    h.advance(0.5);
    expect(h.notes.length).toBeGreaterThan(first);
  });
});

describe('applying edits', () => {
  it('applies immediately while stopped', () => {
    const h = harness();
    expect(h.sequencer.setScore(B)).toBe('applied');
    expect(h.sequencer.hasPending).toBe(false);
    expect(h.sequencer.activeScore).toBe(B);
  });

  it('waits for the bar line while playing, and keeps the old pattern until then', () => {
    const h = harness();
    h.sequencer.start(0);
    h.advance(0.5); // part way into bar 1
    const before = h.notes.length;

    expect(h.sequencer.setScore(B)).toBe('queued');
    expect(h.sequencer.hasPending).toBe(true);
    expect(h.sequencer.activeScore).toBe(A);

    // Notes scheduled before the bar line still belong to the old pattern.
    h.advance(1.0);
    h.notes.slice(before).forEach((note) => {
      expect([60, 64]).toContain(note.event.pitches[0]);
    });

    h.advance(1.2);
    expect(h.sequencer.activeScore).toBe(B);
    expect(h.sequencer.hasPending).toBe(false);
    const swapped = h.notes.filter((note) => [67, 71].includes(note.event.pitches[0] ?? 0));
    expect(swapped.length).toBeGreaterThan(0);
    expect(h.bars.some((bar) => bar.applied)).toBe(true);
  });

  it('keeps the place in the form when the new pattern is the same length', () => {
    const h = harness();
    h.sequencer.start(0);
    h.advance(2.1); // into bar 2
    h.sequencer.setScore(B);
    h.advance(2.0);
    const swapped = h.notes.filter((note) => [67, 71].includes(note.event.pitches[0] ?? 0));
    // The swap happened at the top of a bar, and the bar it landed on is a real bar of B.
    expect(swapped.length).toBeGreaterThan(0);
    expect(h.sequencer.position().bar).toBeLessThan(B.bars);
  });

  it('only ever holds one pending pattern', () => {
    const h = harness();
    h.sequencer.start(0);
    h.advance(0.2);
    h.sequencer.setScore(B);
    const C = score(`tempo 120
bars 2
grid 4
voice lead tone
  play d4 . . . | f4 . . .
`);
    h.sequencer.setScore(C);
    h.advance(2.5);
    expect(h.sequencer.activeScore).toBe(C);
  });

  it('drops a pending pattern when stopped', () => {
    const h = harness();
    h.sequencer.start(0);
    h.advance(0.2);
    h.sequencer.setScore(B);
    h.sequencer.stop();
    expect(h.sequencer.hasPending).toBe(false);
    expect(h.sequencer.activeScore).toBe(A);
  });

  it('handles a swap to a pattern with a different grid and length', () => {
    const short = score(`tempo 96
bars 1
grid 3
voice lead tone
  play c5 . .
`);
    const h = harness();
    h.sequencer.start(0);
    h.advance(0.3);
    h.sequencer.setScore(short);
    h.advance(3);
    expect(h.sequencer.activeScore).toBe(short);
    expect(h.sequencer.position().bar).toBe(0);
    expect(h.notes.some((note) => note.event.pitches[0] === 72)).toBe(true);
  });
});

describe('freeze', () => {
  it('holds the loop on the current bar and releases cleanly', () => {
    const h = harness();
    h.sequencer.start(0);
    h.advance(0.1);
    h.sequencer.setFrozen(true);
    h.advance(6);
    const pitches = new Set(h.notes.map((note) => note.event.pitches[0]));
    expect(pitches).toEqual(new Set([60]));

    h.sequencer.setFrozen(false);
    h.advance(4.5);
    expect(h.notes.some((note) => note.event.pitches[0] === 64)).toBe(true);
  });
});

describe('position reporting', () => {
  it('reports bar, step and phase through the loop', () => {
    const h = harness();
    expect(h.sequencer.position()).toMatchObject({ running: false, bar: 0, bars: 2, grid: 4 });
    h.sequencer.start(0);
    h.advance(2.1);
    const position = h.sequencer.position();
    expect(position.running).toBe(true);
    expect(position.loopPhase).toBeGreaterThan(0);
    expect(position.loopPhase).toBeLessThan(1);
  });
});
