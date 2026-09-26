/**
 * The audio engine.
 *
 * Native Web Audio only: oscillators, a noise buffer, one filter, one shaper, one delay and a
 * limiter. No samples, no libraries, nothing fetched at runtime.
 *
 * It takes a `BaseAudioContext`, not an `AudioContext`, so the whole graph can be rendered
 * offline in a test and measured. Nothing in here starts a context or resumes one; that is the
 * application's job, and it only happens after the player clicks Start.
 */

import type { ScheduledNote } from '../sequencer';
import type { PercHit, Voice } from '../pattern/types';
import {
  AUDIO_LIMITS,
  browningCutoff,
  browningResonance,
  clamp01,
  destructionDrive,
  destructionMakeup,
  makeShaperCurve,
  masterGain,
  memoryDelayTime,
  memoryFeedback,
  memoryWet,
  midiToFrequency,
} from './params';

interface ActiveNote {
  sources: AudioScheduledSourceNode[];
  gain: GainNode;
  /** Audio-clock time the note begins. */
  startsAt: number;
  /** Audio-clock time the note is expected to be finished. */
  endsAt: number;
}

export interface AudioEngineOptions {
  /** Where the finished signal goes. Defaults to `context.destination`. */
  destination?: AudioNode;
  /** Offline renders have no use for an analyser, and it costs a node. */
  analyse?: boolean;
}

/** Deterministic noise, so an offline render of the same pattern is byte-comparable. */
function fillNoise(buffer: AudioBuffer): void {
  const data = buffer.getChannelData(0);
  let seed = 0x9e3779b9;
  for (let i = 0; i < data.length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
}

const OSC_TYPES: Record<string, OscillatorType> = {
  sine: 'sine',
  triangle: 'triangle',
  square: 'square',
  saw: 'sawtooth',
};

export class AudioEngine {
  readonly context: BaseAudioContext;
  readonly analyser: AnalyserNode | null;

  private readonly mixBus: GainNode;
  private readonly colour: BiquadFilterNode;
  private readonly shaper: WaveShaperNode;
  private readonly makeup: GainNode;
  private readonly dry: GainNode;
  private readonly delaySend: GainNode;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly wet: GainNode;
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly noise: AudioBuffer;

  private readonly active = new Set<ActiveNote>();
  private readonly analysisBuffer: Uint8Array<ArrayBuffer> | null;
  private smoothedEnergy = 0;
  private tempo = 120;
  private disposed = false;

  constructor(context: BaseAudioContext, options: AudioEngineOptions = {}) {
    this.context = context;
    const destination = options.destination ?? context.destination;

    this.mixBus = context.createGain();
    this.mixBus.gain.value = 1;

    this.colour = context.createBiquadFilter();
    this.colour.type = 'lowpass';
    this.colour.frequency.value = browningCutoff(0.35);
    this.colour.Q.value = browningResonance(0.35);

    this.shaper = context.createWaveShaper();
    this.shaper.curve = makeShaperCurve(0);
    this.shaper.oversample = '2x';

    this.makeup = context.createGain();
    this.makeup.gain.value = 1;

    this.dry = context.createGain();
    this.dry.gain.value = 1;

    this.delaySend = context.createGain();
    this.delaySend.gain.value = 1;

    this.delay = context.createDelay(AUDIO_LIMITS.delayMax + 0.1);
    this.delay.delayTime.value = memoryDelayTime(this.tempo);

    this.feedback = context.createGain();
    this.feedback.gain.value = memoryFeedback(0.25);

    this.wet = context.createGain();
    this.wet.gain.value = memoryWet(0.25);

    this.master = context.createGain();
    this.master.gain.value = masterGain(0.5);

    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.12;

    this.mixBus.connect(this.colour);
    this.colour.connect(this.shaper);
    this.shaper.connect(this.makeup);
    this.makeup.connect(this.dry);
    this.makeup.connect(this.delaySend);
    this.dry.connect(this.master);
    this.delaySend.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.wet);
    this.wet.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(destination);

    if (options.analyse) {
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      this.limiter.connect(this.analyser);
      this.analysisBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    } else {
      this.analyser = null;
      this.analysisBuffer = null;
    }

    this.noise = context.createBuffer(1, Math.floor(context.sampleRate * 2), context.sampleRate);
    fillNoise(this.noise);
  }

  setTempo(tempo: number): void {
    this.tempo = tempo;
    this.rampParam(this.delay.delayTime, memoryDelayTime(tempo), 0.08);
  }

  setMasterVolume(value: number): void {
    this.rampParam(this.master.gain, masterGain(value), 0.04);
  }

  setBrowning(value: number): void {
    this.rampParam(this.colour.frequency, browningCutoff(value), 0.05);
    this.rampParam(this.colour.Q, browningResonance(value), 0.05);
  }

  setDestruction(value: number): void {
    this.shaper.curve = makeShaperCurve(destructionDrive(value));
    this.rampParam(this.makeup.gain, destructionMakeup(value), 0.05);
  }

  setMemory(value: number): void {
    this.rampParam(this.feedback.gain, memoryFeedback(value), 0.08);
    this.rampParam(this.wet.gain, memoryWet(value), 0.08);
  }

  /** Immediate silence: no tails, no scheduled attacks left standing, empty delay line. */
  kill(): void {
    const now = this.context.currentTime;
    this.active.forEach((note) => this.tearDown(note, now, 0.006));
    this.active.clear();

    const feedbackTarget = this.feedback.gain.value;
    const wetTarget = this.wet.gain.value;
    this.feedback.gain.cancelScheduledValues(now);
    this.feedback.gain.setValueAtTime(0, now);
    this.wet.gain.cancelScheduledValues(now);
    this.wet.gain.setValueAtTime(0, now);

    const masterTarget = this.master.gain.value;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.006);

    // Come back quietly once the line is empty, so Kill is a silence, not an off switch.
    const resume = now + 0.16;
    this.master.gain.setValueAtTime(0, resume);
    this.master.gain.linearRampToValueAtTime(masterTarget, resume + 0.05);
    this.feedback.gain.setValueAtTime(feedbackTarget, resume);
    this.wet.gain.setValueAtTime(wetTarget, resume);
    this.smoothedEnergy = 0;
  }

  /** Play one scheduled note. Voice level and mute come from the parsed score. */
  play(note: ScheduledNote, voice: Voice, voiceGain: number): void {
    if (this.disposed) return;
    const level = clamp01(voiceGain) * clamp01(voice.level);
    if (voice.muted || level <= 0) return;

    // Use the audio clock, not the note's own start time. Scheduling a bar ahead would
    // otherwise treat future notes as already finished and pull them out of the graph.
    const now = this.context.currentTime;
    this.reap(now);
    if (this.active.size >= AUDIO_LIMITS.maxActiveNotes) this.steal(now);

    if (voice.kind === 'perc') {
      const hit = note.event.hit ?? 'hat';
      this.playPerc(hit, note.time, note.event.velocity * level);
      return;
    }

    const pitches = note.event.pitches;
    if (!pitches.length) return;
    // A chord of four already costs eight oscillators; do not let it cost more.
    pitches.slice(0, 4).forEach((midi) => {
      this.playTone(voice, midi, note.time, note.duration, note.event.velocity * level);
    });
  }

  /** 0..1 short-term loudness for the visuals. Returns 0 without an analyser. */
  energy(): number {
    if (!this.analyser || !this.analysisBuffer) return 0;
    this.analyser.getByteTimeDomainData(this.analysisBuffer);
    let sum = 0;
    for (let i = 0; i < this.analysisBuffer.length; i += 1) {
      const sample = ((this.analysisBuffer[i] as number) - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / this.analysisBuffer.length);
    const scaled = clamp01(rms * 3.2);
    this.smoothedEnergy = this.smoothedEnergy * 0.72 + scaled * 0.28;
    return this.smoothedEnergy;
  }

  activeNoteCount(): number {
    return this.active.size;
  }

  dispose(): void {
    this.disposed = true;
    this.kill();
    try {
      this.limiter.disconnect();
    } catch {
      /* already gone */
    }
  }

  private playTone(voice: Voice, midi: number, at: number, duration: number, velocity: number): void {
    const context = this.context;
    const frequency = midiToFrequency(midi);
    const gain = context.createGain();
    const amp = clamp01(velocity) * (voice.kind === 'bass' ? 0.5 : 0.34);

    const attack = voice.kind === 'bass' ? 0.012 : 0.008;
    const hold = Math.max(0.05, duration * 0.92);
    const release = voice.kind === 'bass' ? 0.12 : 0.22;

    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(Math.max(0.0002, amp), at + attack);
    gain.gain.setTargetAtTime(Math.max(0.0001, amp * 0.72), at + attack, hold * 0.6);
    gain.gain.setValueAtTime(Math.max(0.0002, amp * 0.72), at + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + hold + release);

    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(Math.min(16000, frequency * 9), at);
    tone.frequency.exponentialRampToValueAtTime(Math.max(180, frequency * 3), at + hold + release);
    tone.Q.value = 0.9;

    const sources: AudioScheduledSourceNode[] = [];
    const type = OSC_TYPES[voice.wave] ?? 'triangle';
    const detunes = voice.kind === 'bass' ? [0] : [-5, 5];
    detunes.forEach((cents) => {
      const osc = context.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, at);
      osc.detune.setValueAtTime(cents, at);
      osc.connect(tone);
      osc.start(at);
      osc.stop(at + hold + release + 0.05);
      sources.push(osc);
    });

    if (voice.kind === 'bass') {
      // A quiet octave above keeps the bass audible on laptop speakers and headphones alike.
      const upper = context.createOscillator();
      const upperGain = context.createGain();
      upperGain.gain.value = 0.18;
      upper.type = 'sine';
      upper.frequency.setValueAtTime(frequency * 2, at);
      upper.connect(upperGain);
      upperGain.connect(tone);
      upper.start(at);
      upper.stop(at + hold + release + 0.05);
      sources.push(upper);
    }

    tone.connect(gain);
    gain.connect(this.mixBus);
    this.track({ sources, gain, startsAt: at, endsAt: at + hold + release + 0.06 });
  }

  private playPerc(hit: PercHit, at: number, velocity: number): void {
    const context = this.context;
    const amp = clamp01(velocity);
    const gain = context.createGain();
    gain.connect(this.mixBus);
    const sources: AudioScheduledSourceNode[] = [];
    let endsAt = at + 0.3;

    if (hit === 'kick') {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(128, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.11);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(amp * 0.85, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + 0.34);
      sources.push(osc);
      endsAt = at + 0.35;
    } else if (hit === 'snare') {
      const noise = context.createBufferSource();
      noise.buffer = this.noise;
      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1900;
      band.Q.value = 0.8;
      noise.connect(band);
      band.connect(gain);

      const body = context.createOscillator();
      const bodyGain = context.createGain();
      body.type = 'triangle';
      body.frequency.setValueAtTime(196, at);
      body.frequency.exponentialRampToValueAtTime(150, at + 0.08);
      bodyGain.gain.value = 0.35;
      body.connect(bodyGain);
      bodyGain.connect(gain);

      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(amp * 0.55, at + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.19);
      noise.start(at);
      noise.stop(at + 0.22);
      body.start(at);
      body.stop(at + 0.22);
      sources.push(noise, body);
      endsAt = at + 0.23;
    } else if (hit === 'hat') {
      const noise = context.createBufferSource();
      noise.buffer = this.noise;
      noise.playbackRate.value = 1.7;
      const high = context.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 7200;
      noise.connect(high);
      high.connect(gain);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(amp * 0.3, at + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      noise.start(at);
      noise.stop(at + 0.08);
      sources.push(noise);
      endsAt = at + 0.09;
    } else {
      const osc = context.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1620, at);
      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1700;
      band.Q.value = 6;
      osc.connect(band);
      band.connect(gain);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(amp * 0.4, at + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
      osc.start(at);
      osc.stop(at + 0.06);
      sources.push(osc);
      endsAt = at + 0.07;
    }

    this.track({ sources, gain, startsAt: at, endsAt });
  }

  private track(note: ActiveNote): void {
    this.active.add(note);
  }

  private reap(now: number): void {
    this.active.forEach((note) => {
      if (note.endsAt <= now) {
        try {
          note.gain.disconnect();
        } catch {
          /* already disconnected */
        }
        this.active.delete(note);
      }
    });
  }

  private steal(now: number): void {
    const notes = Array.from(this.active);
    if (!notes.length) return;
    // Prefer a note that is already sounding. Stopping a note before its start time
    // cancels it entirely, which would drop music that was only scheduled early.
    const sounding = notes.filter((note) => note.startsAt <= now);
    if (!sounding.length) {
      // Nothing is sounding yet. Drop the note scheduled furthest ahead, which is the one
      // that just overflowed the limit, and leave the earlier music in place.
      let latest = notes[0] as ActiveNote;
      for (const note of notes) {
        if (note.startsAt >= latest.startsAt) latest = note;
      }
      this.tearDown(latest, latest.startsAt, 0.01);
      this.active.delete(latest);
      return;
    }
    let oldest = sounding[0] as ActiveNote;
    for (const note of sounding) {
      if (note.endsAt < oldest.endsAt) oldest = note;
    }
    this.tearDown(oldest, now, 0.01);
    this.active.delete(oldest);
  }

  private tearDown(note: ActiveNote, now: number, fade: number): void {
    try {
      note.gain.gain.cancelScheduledValues(now);
      note.gain.gain.setValueAtTime(Math.max(0.0001, note.gain.gain.value), now);
      note.gain.gain.linearRampToValueAtTime(0, now + fade);
    } catch {
      /* the node may already be finished */
    }
    note.sources.forEach((source) => {
      try {
        source.stop(now + fade);
      } catch {
        /* already stopped */
      }
    });
  }

  private rampParam(param: AudioParam, target: number, seconds: number): void {
    const now = this.context.currentTime;
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + Math.max(0.005, seconds));
    } catch {
      param.value = target;
    }
  }
}
