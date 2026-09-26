import { describe, expect, it } from 'vitest';
import {
  AUDIO_LIMITS,
  browningCutoff,
  browningResonance,
  destructionDrive,
  destructionMakeup,
  makeShaperCurve,
  masterGain,
  memoryDelayTime,
  memoryFeedback,
  memoryWet,
  midiToFrequency,
} from '../../src/core/audio/params';

const EXTREMES = [-99, -1, 0, 0.5, 1, 2, 1e9, Number.NaN, Number.POSITIVE_INFINITY];

describe('audio parameter bounds', () => {
  it('caps the master fader below unity whatever it is asked for', () => {
    EXTREMES.forEach((value) => {
      const gain = masterGain(value);
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(AUDIO_LIMITS.masterGainMax);
    });
    expect(masterGain(1)).toBeCloseTo(AUDIO_LIMITS.masterGainMax);
  });

  it('keeps delay feedback under the runaway threshold', () => {
    EXTREMES.forEach((value) => {
      expect(memoryFeedback(value)).toBeLessThanOrEqual(AUDIO_LIMITS.feedbackMax);
      expect(memoryFeedback(value)).toBeGreaterThanOrEqual(0);
      expect(memoryWet(value)).toBeLessThanOrEqual(AUDIO_LIMITS.wetMax);
    });
    expect(AUDIO_LIMITS.feedbackMax).toBeLessThan(1);
  });

  it('keeps the delay time musical and inside the line length', () => {
    [20, 58, 104, 300].forEach((tempo) => {
      const time = memoryDelayTime(tempo);
      expect(time).toBeGreaterThanOrEqual(AUDIO_LIMITS.delayMin);
      expect(time).toBeLessThanOrEqual(AUDIO_LIMITS.delayMax);
    });
    expect(memoryDelayTime(0)).toBeGreaterThan(0);
    expect(memoryDelayTime(Number.NaN)).toBeGreaterThan(0);
    expect(memoryDelayTime(120)).toBeCloseTo(0.375, 6);
  });

  it('darkens monotonically as browning rises, and stays inside the audible band', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let value = 0; value <= 1.0001; value += 0.05) {
      const cutoff = browningCutoff(value);
      expect(cutoff).toBeLessThanOrEqual(AUDIO_LIMITS.cutoffMax + 1e-6);
      expect(cutoff).toBeGreaterThanOrEqual(AUDIO_LIMITS.cutoffMin - 1e-6);
      expect(cutoff).toBeLessThan(previous);
      previous = cutoff;
    }
    expect(browningResonance(0)).toBeCloseTo(0.7);
    expect(browningResonance(1)).toBeCloseTo(3);
  });

  it('never folds the distortion curve back on itself', () => {
    [0, 0.25, 0.5, 1, 7].forEach((value) => {
      const curve = makeShaperCurve(destructionDrive(value));
      expect(curve.length).toBe(1024);
      let previous = Number.NEGATIVE_INFINITY;
      curve.forEach((sample) => {
        expect(Number.isFinite(sample)).toBe(true);
        expect(Math.abs(sample)).toBeLessThanOrEqual(1.000001);
        expect(sample).toBeGreaterThanOrEqual(previous);
        previous = sample;
      });
    });
    expect(destructionDrive(1)).toBe(AUDIO_LIMITS.driveMax);
    expect(destructionMakeup(1)).toBeLessThan(destructionMakeup(0));
  });

  it('converts MIDI to pitch at concert A', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440);
    expect(midiToFrequency(60)).toBeCloseTo(261.626, 3);
    expect(midiToFrequency(81)).toBeCloseTo(880);
  });
});
