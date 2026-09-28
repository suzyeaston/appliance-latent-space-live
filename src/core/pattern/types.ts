export type VoiceKind = 'tone' | 'bass' | 'perc';
export type Waveform = 'sine' | 'triangle' | 'square' | 'saw';
export type PercHit = 'kick' | 'snare' | 'hat' | 'rim';

export const VOICE_KINDS: readonly VoiceKind[] = ['tone', 'bass', 'perc'];
export const WAVEFORMS: readonly Waveform[] = ['sine', 'triangle', 'square', 'saw'];
export const PERC_HITS: readonly PercHit[] = ['kick', 'snare', 'hat', 'rim'];

/** Hard ceilings. They exist so a typo cannot ask the audio engine for 4000 oscillators. */
export const LIMITS = {
  tempoMin: 20,
  tempoMax: 300,
  barsMin: 1,
  barsMax: 16,
  gridMin: 1,
  gridMax: 32,
  voicesMax: 8,
  chordMax: 4,
  octaveShiftMax: 3,
  midiMin: 12,
  midiMax: 108,
  eventsMax: 2048,
} as const;

export interface NoteEvent {
  /** Index into `Score.voices`. */
  voice: number;
  /** Absolute step within the loop: 0 .. bars * grid - 1. */
  step: number;
  /** Duration in steps, at least 1. Ties (`_`) add steps. */
  steps: number;
  /** MIDI note numbers. Empty for percussion. */
  pitches: number[];
  /** Percussion sound, when the voice kind is `perc`. */
  hit?: PercHit;
  /** 0..1. */
  velocity: number;
  /** 1-based source line the token came from, for editor feedback. */
  line: number;
}

export interface Voice {
  name: string;
  kind: VoiceKind;
  wave: Waveform;
  level: number;
  muted: boolean;
  /** Octave transposition applied at parse time; kept for display. */
  octave: number;
  /** Bars written for this voice before repetition to the full loop length. */
  writtenBars: number;
}

export interface Score {
  /** Delay alternating subdivisions, 0 = straight, maximum 0.45. */
  swing?: number;
  tempo: number;
  bars: number;
  grid: number;
  voices: Voice[];
  /** Flattened, sorted by step then voice. Covers exactly one loop. */
  events: NoteEvent[];
  /** Total steps in the loop. */
  totalSteps: number;
  /** The exact text this score was parsed from. */
  source: string;
}

export interface PatternIssue {
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** Length of the offending text, for underlining. */
  length: number;
  message: string;
  hint?: string;
}

export type ParseResult =
  | { ok: true; score: Score; warnings: PatternIssue[] }
  | { ok: false; errors: PatternIssue[]; warnings: PatternIssue[] };

export function stepsPerBeat(grid: number): number {
  // The grid is steps per bar in 4/4, so a beat is a quarter of it.
  return grid / 4;
}

export function secondsPerStep(tempo: number, grid: number): number {
  const secondsPerBeat = 60 / tempo;
  return secondsPerBeat / stepsPerBeat(grid);
}
