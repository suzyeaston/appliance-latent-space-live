/**
 * Renders the real audio engine through OfflineAudioContext.
 *
 * This checks that synthesis, envelopes and the bounded effects produce finite, timed audio.
 * It does not listen. A human still has to hear the instrument to judge whether it sounds right.
 */

import { AudioEngine } from '../../src/core/audio/engine';
import { parsePattern } from '../../src/core/pattern/parse';
import type { Score, Voice } from '../../src/core/pattern/types';
import { secondsPerStep } from '../../src/core/pattern/types';
import { Sequencer, type ScheduledNote } from '../../src/core/sequencer';

export interface AudioCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface AudioReport {
  ok: boolean;
  checks: AudioCheck[];
  error?: string;
}

const SAMPLE_RATE = 44100;

function collect(score: Score, seconds: number): ScheduledNote[] {
  let time = 0;
  const notes: ScheduledNote[] = [];
  const sequencer = new Sequencer(score, {
    now: () => time,
    onNotes: (batch) => notes.push(...batch),
    lookahead: 0.25,
  });
  sequencer.start(0);
  const steps = Math.ceil(seconds / 0.02);
  for (let i = 0; i < steps; i += 1) {
    time += 0.02;
    sequencer.tick();
  }
  return notes;
}

function playAll(engine: AudioEngine, score: Score, notes: ScheduledNote[]): void {
  notes.forEach((note) => {
    const voice = score.voices[note.event.voice];
    if (voice) engine.play(note, voice, 1);
  });
}

async function render(score: Score, seconds: number, setup: (engine: AudioEngine, notes: ScheduledNote[]) => void): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * seconds), SAMPLE_RATE);
  const engine = new AudioEngine(context);
  engine.setTempo(score.tempo);
  const notes = collect(score, seconds);
  setup(engine, notes);
  const buffer = await context.startRendering();
  engine.dispose();
  return buffer.getChannelData(0);
}

function rms(samples: Float32Array, start: number, end: number, rate: number): number {
  const from = Math.max(0, Math.floor(start * rate));
  const to = Math.min(samples.length, Math.floor(end * rate));
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += (samples[i] as number) * (samples[i] as number);
  return Math.sqrt(sum / (to - from));
}

function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.abs(samples[i] as number);
    if (value > max) max = value;
  }
  return max;
}

function finite(samples: Float32Array): boolean {
  for (let i = 0; i < samples.length; i += 1) {
    if (!Number.isFinite(samples[i] as number)) return false;
  }
  return true;
}

function mustParse(source: string): Score {
  const result = parsePattern(source);
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.message).join('; '));
  return result.score;
}

const ONE_NOTE = `tempo 120
bars 1
grid 4
voice lead tone
  wave sine
  level 0.8
  play . c4 . .
`;

const STACK = `tempo 100
bars 1
grid 4
voice lead tone
  play [c4 e4 g4 b4] [c4 e4 g4 b4] [c4 e4 g4 b4] [c4 e4 g4 b4]
voice low bass
  play c2 c2 c2 c2
voice drums perc
  play kick snare hat rim
`;

export async function runAudioChecks(): Promise<AudioReport> {
  const checks: AudioCheck[] = [];
  const record = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };

  const single = mustParse(ONE_NOTE);
  const singleSamples = await render(single, 2.2, (engine, notes) => {
    engine.setMasterVolume(0.7);
    engine.setBrowning(0.2);
    engine.setDestruction(0);
    engine.setMemory(0);
    playAll(engine, single, notes);
  });

  const step = secondsPerStep(single.tempo, single.grid);
  const attack = 0.06 + step;
  record(
    'a scheduled note is silent before its attack',
    rms(singleSamples, 0, attack - 0.02, SAMPLE_RATE) < 0.001,
    `pre-attack rms ${rms(singleSamples, 0, attack - 0.02, SAMPLE_RATE).toFixed(5)}`,
  );
  record(
    'the same note sounds after its attack',
    rms(singleSamples, attack + 0.02, attack + 0.25, SAMPLE_RATE) > 0.01,
    `note rms ${rms(singleSamples, attack + 0.02, attack + 0.25, SAMPLE_RATE).toFixed(5)}`,
  );
  record('every sample is finite', finite(singleSamples), `peak ${peak(singleSamples).toFixed(4)}`);
  record(
    'the master path does not hard-clip a single voice',
    peak(singleSamples) < 0.99,
    `peak ${peak(singleSamples).toFixed(4)}`,
  );

  const muted: Voice[] = single.voices.map((voice) => ({ ...voice, muted: true }));
  const mutedScore: Score = { ...single, voices: muted };
  const mutedSamples = await render(mutedScore, 1.2, (engine, notes) => playAll(engine, mutedScore, notes));
  record('a muted voice stays silent', peak(mutedSamples) < 0.001, `peak ${peak(mutedSamples).toFixed(5)}`);

  const killed = await render(single, 1.5, (engine, notes) => {
    engine.setMasterVolume(0.8);
    playAll(engine, single, notes);
    engine.kill();
  });
  record('kill clears scheduled notes', peak(killed) < 0.02, `peak ${peak(killed).toFixed(5)}`);

  const stack = mustParse(STACK);
  const driven = await render(stack, 3.5, (engine, notes) => {
    engine.setMasterVolume(1);
    engine.setBrowning(1);
    engine.setDestruction(1);
    engine.setMemory(1);
    playAll(engine, stack, notes);
    playAll(engine, stack, notes);
  });
  record(
    'full destruction and memory stay finite and bounded',
    finite(driven) && peak(driven) <= 1,
    `peak ${peak(driven).toFixed(4)}, finite ${finite(driven)}`,
  );
  record(
    'the driven render is still audible',
    rms(driven, 0.2, 2.5, SAMPLE_RATE) > 0.005,
    `rms ${rms(driven, 0.2, 2.5, SAMPLE_RATE).toFixed(5)}`,
  );

  const dry = await render(stack, 2, (engine, notes) => {
    engine.setMasterVolume(0.7);
    engine.setBrowning(0);
    engine.setMemory(0);
    playAll(engine, stack, notes);
  });
  const dark = await render(stack, 2, (engine, notes) => {
    engine.setMasterVolume(0.7);
    engine.setBrowning(1);
    engine.setMemory(0);
    playAll(engine, stack, notes);
  });
  record(
    'browning changes the signal',
    Math.abs(rms(dry, 0.1, 1.6, SAMPLE_RATE) - rms(dark, 0.1, 1.6, SAMPLE_RATE)) > 0.001,
    `dry ${rms(dry, 0.1, 1.6, SAMPLE_RATE).toFixed(4)} dark ${rms(dark, 0.1, 1.6, SAMPLE_RATE).toFixed(4)}`,
  );

  return { ok: checks.every((check) => check.ok), checks };
}
