/**
 * The Variation provider: a deterministic pattern transformer, not an AI.
 *
 * Given the same pattern and the same seed it returns the same result every time, offline. It
 * works on parsed score data and prints valid pattern text back out, so its output is subject to
 * exactly the same parser as anything typed by hand.
 */

import { formatScore } from '../pattern/format';
import { parsePattern } from '../pattern/parse';
import type { NoteEvent, Score } from '../pattern/types';
import type { ProposalOutcome, ProposalProvider, ProposalRequest } from './types';

/** Mulberry32. Small, fast, and identical across runs. */
function rng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneEvent(event: NoteEvent): NoteEvent {
  return { ...event, pitches: [...event.pitches] };
}

interface Transformed {
  events: NoteEvent[];
  notes: string[];
}

function transform(score: Score, seed: number): Transformed {
  const random = rng(seed);
  const notes: string[] = [];
  const events = score.events.map(cloneEvent);
  const occupied = new Set(events.map((event) => `${event.voice}:${event.step}`));

  let displaced = 0;
  let thinned = 0;
  let held = 0;
  let lifted = 0;

  events.forEach((event) => {
    const voice = score.voices[event.voice];
    if (!voice) return;

    if (voice.kind === 'bass') return; // The bass is the floor. Variation leaves it alone.

    if (voice.kind === 'perc') {
      // Nudge a minority of hits off the grid they were written on.
      if (random() < 0.28) {
        const direction = random() < 0.5 ? -1 : 1;
        const target = event.step + direction;
        const key = `${event.voice}:${target}`;
        if (target >= 0 && target < score.totalSteps && !occupied.has(key)) {
          occupied.delete(`${event.voice}:${event.step}`);
          occupied.add(key);
          event.step = target;
          displaced += 1;
        }
      }
      if (random() < 0.12) {
        event.velocity = Math.max(0.1, Math.min(1, event.velocity * 0.6));
      }
      return;
    }

    // Tonal voices: let some of the line dissolve, and let some of it hang on.
    const roll = random();
    if (roll < 0.22) {
      event.velocity = 0;
      thinned += 1;
    } else if (roll < 0.42) {
      const room = score.grid - (event.step % score.grid);
      const extra = 1 + Math.floor(random() * 2);
      event.steps = Math.max(1, Math.min(event.steps + extra, room));
      held += 1;
    } else if (roll < 0.52 && event.pitches.length) {
      const shift = random() < 0.5 ? -12 : 12;
      const moved = event.pitches.map((pitch) => pitch + shift);
      if (moved.every((pitch) => pitch >= 24 && pitch <= 96)) {
        event.pitches = moved;
        lifted += 1;
      }
    }
  });

  const surviving = events.filter((event) => event.velocity > 0);
  surviving.sort((a, b) => a.step - b.step || a.voice - b.voice);

  if (displaced) notes.push(`Moved ${displaced} percussion hit${displaced === 1 ? '' : 's'} off the grid.`);
  if (thinned) notes.push(`Removed ${thinned} note${thinned === 1 ? '' : 's'} from the tonal voices.`);
  if (held) notes.push(`Lengthened ${held} note${held === 1 ? '' : 's'}.`);
  if (lifted) notes.push(`Shifted ${lifted} note${lifted === 1 ? '' : 's'} by an octave.`);
  if (!notes.length) notes.push('This seed changed nothing. Try the next one.');
  notes.push('Bass, tempo, grid and loop length are untouched.');

  return { events: surviving, notes };
}

export const variationProvider: ProposalProvider = {
  id: 'variation',
  label: 'Variation',
  description: 'A deterministic transformation of your own pattern. No model, no network.',
  usesNetwork: false,

  async propose(request: ProposalRequest): Promise<ProposalOutcome> {
    const parsed = parsePattern(request.pattern);
    if (!parsed.ok) {
      return { ok: false, reason: 'The current pattern has to be valid before it can be varied.' };
    }
    const { events, notes } = transform(parsed.score, request.seed);
    if (!events.length) {
      return { ok: false, reason: 'That seed emptied the pattern. Try the next one.' };
    }
    const varied: Score = { ...parsed.score, events };
    const pattern = formatScore(varied, `Variation of the current pattern, seed ${request.seed}.`);

    // The provider validates its own output before offering it. A provider that cannot produce a
    // playable pattern must fail loudly rather than hand the player something broken.
    const check = parsePattern(pattern);
    if (!check.ok) {
      return { ok: false, reason: 'The variation did not come out valid. Nothing was changed.' };
    }

    return {
      ok: true,
      proposal: {
        providerId: variationProvider.id,
        label: `Variation · seed ${request.seed}`,
        pattern,
        notes,
        seed: request.seed,
      },
    };
  },
};
