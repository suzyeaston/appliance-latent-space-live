import { clamp01 } from '../audio/params';
import { LIMITS, type Score, type Waveform } from '../pattern/types';

export function stagePoint(x: number, y: number): { timbre: number; midi: number; wave: Waveform } {
  const timbre = clamp01(x);
  const waves: Waveform[] = ['sine', 'triangle', 'saw', 'square'];
  return { timbre, midi: Math.round(48 + (1 - clamp01(y)) * 36), wave: waves[Math.min(3, Math.floor(timbre * 4))]! };
}

/** Overdub one grid-snapped gesture lane, leaving the other voices untouched. */
export function writeGesture(score: Score, points: Array<{ step: number; midi: number }>, wave: Waveform): Score {
  const next = structuredClone(score);
  let voice = next.voices.findIndex(v => v.name === 'visual');
  if (voice < 0) {
    if (next.voices.length >= LIMITS.voicesMax) throw new Error('All eight voices are in use. Remove one before keeping a visual gesture.');
    voice = next.voices.length;
    next.voices.push({ name: 'visual', kind: 'tone', wave, level: 0.6, muted: false, octave: 0, writtenBars: next.bars });
  }
  next.voices[voice]!.wave = wave;
  const steps = new Map<number, number>();
  for (const p of points) if (Number.isFinite(p.step) && Number.isFinite(p.midi)) {
    steps.set(Math.max(0, Math.min(next.totalSteps - 1, Math.floor(p.step))), Math.max(48, Math.min(84, Math.round(p.midi))));
  }
  next.events = next.events.filter(e => e.voice !== voice || !steps.has(e.step));
  for (const [step, midi] of steps) next.events.push({ voice, step, steps: 1, pitches: [midi], velocity: 0.7, line: 1 });
  next.events.sort((a,b) => a.step - b.step || a.voice - b.voice);
  return next;
}
