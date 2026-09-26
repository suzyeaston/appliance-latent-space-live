/**
 * Every control-to-audio mapping lives here as a pure function, so the bounds can be tested
 * without an audio context. If a number can reach a gain, a feedback path or a filter, it is
 * clamped in this file before it gets anywhere near one.
 */

export const AUDIO_LIMITS = {
  /** Ceiling on the master fader, well under unity so a stack of voices cannot clip. */
  masterGainMax: 0.7,
  /** Hard ceiling on delay regeneration. Above this the line runs away. */
  feedbackMax: 0.72,
  wetMax: 0.5,
  /** Simultaneous sounding notes. Older ones are stolen past this. */
  maxActiveNotes: 24,
  cutoffMin: 320,
  cutoffMax: 9000,
  driveMax: 24,
  delayMin: 0.05,
  delayMax: 1.2,
} as const;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Master fader. The UI range is 0..1; the graph never sees more than `masterGainMax`. */
export function masterGain(value: number): number {
  const v = clamp01(value);
  // Perceptual-ish taper: quiet end gets more of the travel.
  return AUDIO_LIMITS.masterGainMax * v * v;
}

/**
 * browning: raw at 0, cooked at 1. It darkens the master low-pass exponentially and leans a
 * little resonance in as it closes, which is where the "harmonic colour" part comes from.
 */
export function browningCutoff(value: number): number {
  const v = clamp01(value);
  const ratio = AUDIO_LIMITS.cutoffMin / AUDIO_LIMITS.cutoffMax;
  return AUDIO_LIMITS.cutoffMax * Math.pow(ratio, v);
}

export function browningResonance(value: number): number {
  return 0.7 + clamp01(value) * 2.3;
}

/** destruction: 0 is a straight wire. The curve saturates, it never folds back on itself. */
export function destructionDrive(value: number): number {
  return clamp01(value) * AUDIO_LIMITS.driveMax;
}

/** Keeps perceived level roughly constant as the drive comes up. */
export function destructionMakeup(value: number): number {
  return 1 / (1 + clamp01(value) * 1.6);
}

export function makeShaperCurve(drive: number, samples = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const k = Math.max(0, drive);
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = k === 0 ? x : Math.tanh(x * (1 + k)) / Math.tanh(1 + k);
  }
  return curve;
}

/** memory: how much of the last thing survives. Feedback and wet level are both capped. */
export function memoryFeedback(value: number): number {
  return clamp01(value) * AUDIO_LIMITS.feedbackMax;
}

export function memoryWet(value: number): number {
  return clamp01(value) * AUDIO_LIMITS.wetMax;
}

/** A dotted eighth against the current tempo, so the echo stays in the music. */
export function memoryDelayTime(tempo: number): number {
  const beat = 60 / (Number.isFinite(tempo) && tempo > 0 ? tempo : 120);
  return Math.min(AUDIO_LIMITS.delayMax, Math.max(AUDIO_LIMITS.delayMin, beat * 0.75));
}
