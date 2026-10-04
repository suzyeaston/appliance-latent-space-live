/**
 * The visual system.
 *
 * Two score views share the same rule: geometry comes from the music, not decorative randomness.
 *
 * LINEAR SCORE (orbit near zero)
 *   x = loop time, y = pitch, length = duration.
 *
 * MUSICAL FIELD (default)
 *   angle = loop time, radius = pitch, arc length = duration, stroke weight = velocity.
 *   tempo drives a beat-synchronous pulse, and the musical dialect changes the geometry:
 *   house = clock, broken = fracture, dub = echoes, ambient = nebula, electro = circuit.
 *
 * Audio energy only changes brightness. It never moves a note away from its scored position.
 */

import { DEFAULT_STYLE, type Style } from '../learning/visualModel';
import type { PercHit, Score, VoiceKind } from '../pattern/types';
import { musicalVisualIdentity, type MusicalVisualIdentity } from './musicGrammar';

export interface VisualNote {
  voice: number;
  kind: VoiceKind;
  pitches: number[];
  hit?: PercHit;
  velocity: number;
  /** Audio-clock attack time. */
  time: number;
  duration: number;
  loopStep: number;
  /** Duration in steps, which is what the visual arc/trail length is drawn from. */
  steps: number;
  totalSteps: number;
}

export interface TimelineAnchor {
  /** Audio-clock time of the bar line. */
  time: number;
  bar: number;
  bars: number;
  secondsPerBar: number;
}

export interface VisualizerOptions {
  now: () => number;
  energy: () => number;
}

const PITCH_LOW = 24;
const PITCH_HIGH = 96;
const PERC_LANES: PercHit[] = ['kick', 'snare', 'rim', 'hat'];
const MAX_TRACKED_NOTES = 512;
const BACKDROP = '#05050c';
const TAU = Math.PI * 2;

interface TrackedNote extends VisualNote {
  /** Last drawn progress 0..1 for linear mode. */
  drawn: number;
  ringDrawn: boolean;
}

export function voiceHue(kind: VoiceKind, index: number): number {
  const base = kind === 'bass' ? 264 : kind === 'perc' ? 222 : 194;
  return (base + index * 9) % 360;
}

/** How fast the frame fades. Higher memory keeps traces longer. Always in (0, 1). */
export function memoryFade(memory: number): number {
  const clamped = Math.min(1, Math.max(0, memory));
  return 0.34 - clamped * 0.315;
}

export interface NoteLayout {
  x: number;
  y: number;
  /** Full trail length in pixels once the note has finished sounding. */
  length: number;
  hue: number;
}

export function layoutNote(
  note: Pick<VisualNote, 'voice' | 'kind' | 'pitches' | 'hit' | 'loopStep' | 'steps' | 'totalSteps'>,
  width: number,
  height: number,
): NoteLayout {
  const stepWidth = width / Math.max(1, note.totalSteps);
  const x = note.loopStep * stepWidth;
  const length = Math.max(stepWidth * 0.5, note.steps * stepWidth);
  const y = note.kind === 'perc' && note.hit ? percY(note.hit, height) : pitchY(note.pitches[0] ?? 60, height);
  return { x, y, length, hue: voiceHue(note.kind, note.voice) };
}

export function pitchY(midi: number, height: number): number {
  const field = height * 0.74;
  const clamped = Math.min(PITCH_HIGH, Math.max(PITCH_LOW, midi));
  const ratio = (clamped - PITCH_LOW) / (PITCH_HIGH - PITCH_LOW);
  return field - ratio * (field - 18) + 8;
}

export function percY(hit: PercHit, height: number): number {
  const top = height * 0.78;
  const lane = Math.max(0, PERC_LANES.indexOf(hit));
  const spacing = (height - top - 14) / PERC_LANES.length;
  return top + spacing * (lane + 0.5) + 6;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export class Visualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly now: () => number;
  private readonly energy: () => number;

  private style: Style = { ...DEFAULT_STYLE };
  private identity: MusicalVisualIdentity = {
    dialect: 'free', label: 'FREE', geometry: 'hybrid', hueShift: 0, echoLayers: 2,
    angularWarp: 0.05, radialSpread: 0.84, tempo: 120, density: 0.4, sustain: 0.3,
    syncopation: 0.25, percussion: 0.25, fourFloor: 0.25, swing: 0,
  };

  private notes: TrackedNote[] = [];
  private anchor: TimelineAnchor | null = null;
  private frame = 0;
  private running = false;
  private memory = 0.25;
  private intensity = 0.7;
  private reducedMotion = false;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private smoothedEnergy = 0;

  constructor(canvas: HTMLCanvasElement, options: VisualizerOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser did not provide a 2D canvas context.');
    this.ctx = ctx;
    this.now = options.now;
    this.energy = options.energy;
    this.resize();
  }

  setStyle(style: Style): void { this.style = { ...style }; }
  setScore(score: Score): void { this.identity = musicalVisualIdentity(score); }

  setMemory(value: number): void { this.memory = clamp01(value); }
  setIntensity(value: number): void { this.intensity = clamp01(value); }
  setReducedMotion(value: boolean): void { this.reducedMotion = value; }
  setAnchor(anchor: TimelineAnchor): void { this.anchor = anchor; }

  pushNotes(notes: VisualNote[]): void {
    notes.forEach((note) => this.notes.push({ ...note, drawn: 0, ringDrawn: false }));
    if (this.notes.length > MAX_TRACKED_NOTES) this.notes.splice(0, this.notes.length - MAX_TRACKED_NOTES);
  }

  clearNotes(): void {
    this.notes = [];
    this.anchor = null;
  }

  wipe(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = BACKDROP;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(320, Math.floor(rect.width));
    this.height = Math.max(200, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.wipe();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (): void => {
      if (!this.running) return;
      this.draw();
      this.frame = window.requestAnimationFrame(loop);
    };
    this.frame = window.requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private draw(): void {
    const ctx = this.ctx;
    const now = this.now();
    const raw = this.energy();
    this.smoothedEnergy = this.smoothedEnergy * 0.8 + raw * 0.2;
    const energy = this.smoothedEnergy;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const fade = 0.30 - (this.memory * 0.3 + this.style.trails * 0.7) * 0.275;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(5, 5, 12, ${fade.toFixed(3)})`;
    ctx.fillRect(0, 0, this.width, this.height);

    const phase = this.loopPhase(now);
    this.prune(now);

    if (this.style.orbit < 0.08) {
      this.drawLinearFurniture(energy);
      ctx.globalCompositeOperation = 'lighter';
      this.notes.forEach((note) => this.drawLinearNote(note, now, energy));
      ctx.globalCompositeOperation = 'source-over';
      if (phase !== null) this.drawPlayhead(phase, energy);
      this.drawLegend('LINEAR SCORE', `${Math.round(this.identity.tempo)} BPM`, 'x=time · y=pitch · trail=duration');
    } else {
      this.drawMusicalFurniture(now, energy, phase);
      ctx.globalCompositeOperation = 'lighter';
      this.drawMusicalField(now, energy, phase);
      ctx.globalCompositeOperation = 'source-over';
      this.drawLegend(
        `${this.identity.label} · ${this.identity.geometry.toUpperCase()}`,
        `${Math.round(this.identity.tempo)} BPM`,
        'angle=time · radius=pitch · arc=duration · weight=velocity',
      );
    }

    this.drawImperfection(now, energy);
  }

  private loopPhase(now: number): number | null {
    const anchor = this.anchor;
    if (!anchor || anchor.secondsPerBar <= 0 || anchor.bars <= 0) return null;
    const barProgress = (now - anchor.time) / anchor.secondsPerBar;
    const position = (anchor.bar + Math.max(0, barProgress)) / anchor.bars;
    return position - Math.floor(position);
  }

  private beatPhase(now: number): number {
    const anchor = this.anchor;
    if (!anchor || anchor.secondsPerBar <= 0) return 0;
    const secondsPerBeat = anchor.secondsPerBar / 4;
    const beat = (now - anchor.time) / secondsPerBeat;
    return beat - Math.floor(beat);
  }

  private drawLegend(title: string, tempo: string, mapping: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = 'rgba(222, 216, 255, .78)';
    ctx.fillText(`${title} · ${tempo}`, 16, 22);
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = 'rgba(166, 179, 214, .58)';
    ctx.fillText(mapping, 16, 38);
    ctx.restore();
  }

  private drawMusicalFurniture(now: number, energy: number, phase: number | null): void {
    const ctx = this.ctx;
    const { x: cx, y: cy, radius } = this.fieldGeometry();
    const beat = this.beatPhase(now);
    const pulse = Math.pow(1 - beat, 4);
    const hue = (this.style.hue + this.identity.hueShift + 360) % 360;
    const intensity = 0.5 + this.intensity * 0.5;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1;

    if (this.identity.geometry === 'clock' || this.identity.geometry === 'circuit' || this.identity.geometry === 'fracture') {
      const rays = this.identity.geometry === 'circuit' ? 8 : 4;
      for (let i = 0; i < rays; i += 1) {
        const a = -Math.PI / 2 + i / rays * TAU;
        const inner = radius * 0.24;
        const outer = radius * (1.03 + pulse * 0.025);
        ctx.strokeStyle = `hsla(${hue}, 72%, 66%, ${0.06 + (i === 0 ? pulse * 0.08 : 0)})`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner * 0.78);
        ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer * 0.78);
        ctx.stroke();
      }
    }

    const ringCount = this.identity.geometry === 'echo' ? 5 : this.identity.geometry === 'nebula' ? 3 : 4;
    for (let i = 1; i <= ringCount; i += 1) {
      const r = radius * (0.22 + i / ringCount * 0.78);
      const wobble = this.identity.geometry === 'nebula' && !this.reducedMotion
        ? 1 + Math.sin((phase ?? 0) * TAU + i * 0.7) * 0.012 * this.style.motion
        : 1;
      ctx.strokeStyle = `hsla(${(hue + i * 6) % 360}, 60%, 65%, ${(0.035 + energy * 0.025) * intensity})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * wobble, r * this.verticalScale() / wobble, this.fieldTilt(), 0, TAU);
      ctx.stroke();
    }

    const core = 7 + pulse * (12 + this.identity.tempo / 24) * (this.reducedMotion ? 0.35 : 1);
    ctx.fillStyle = `hsla(${hue}, 90%, 82%, ${0.10 + pulse * 0.20 + energy * 0.12})`;
    ctx.beginPath();
    ctx.arc(cx, cy, core, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = `hsla(${hue}, 90%, 76%, ${0.11 + pulse * 0.16})`;
    ctx.beginPath();
    ctx.arc(cx, cy, core + 8, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  private drawMusicalField(now: number, energy: number, phase: number | null): void {
    const active = this.notes
      .filter(note => now >= note.time - 0.02 && now < note.time + note.duration + 1.8)
      .slice(-128);
    if (!active.length) return;

    const ctx = this.ctx;
    const { x: cx, y: cy, radius: fieldRadius } = this.fieldGeometry();
    const loopRotation = this.reducedMotion ? 0 : (phase ?? 0) * this.style.motion * 0.10;

    for (const note of active) {
      const age = Math.max(0, now - note.time);
      const sounding = age <= note.duration;
      const post = Math.max(0, age - note.duration);
      const fade = sounding ? 1 : Math.max(0, 1 - post / (0.65 + this.memory * 1.2));
      if (fade <= 0) continue;

      const basePitch = note.pitches[0] ?? this.percussionPitch(note.hit);
      const pitchNorm = clamp01((basePitch - PITCH_LOW) / (PITCH_HIGH - PITCH_LOW));
      const radial = fieldRadius * (0.28 + pitchNorm * 0.68 * this.identity.radialSpread * (0.78 + this.style.spread * 0.34));
      const swingOffset = (note.loopStep % 2 ? this.identity.swing : 0) / Math.max(1, note.totalSteps) * TAU * 0.55;
      const startAngle = -Math.PI / 2 + (note.loopStep / Math.max(1, note.totalSteps)) * TAU + swingOffset + loopRotation;
      const arcSpan = Math.max(0.015, note.steps / Math.max(1, note.totalSteps) * TAU);
      const progress = sounding ? Math.min(1, age / Math.max(0.03, note.duration)) : 1;
      const endAngle = startAngle + arcSpan * progress;
      const kindHue = note.kind === 'bass' ? 38 : note.kind === 'perc' ? 190 : 0;
      const hue = (this.style.hue + this.identity.hueShift + kindHue + note.voice * 13) % 360;
      const alpha = fade * (0.16 + note.velocity * 0.50) * (0.42 + this.intensity * 0.58);
      const weight = (note.kind === 'bass' ? 3.8 : 1.8) + note.velocity * 2.8 + energy * 2.4;

      if (note.kind === 'perc' && note.hit) {
        const point = this.fieldPoint(startAngle, radial, cx, cy);
        this.drawPercussionGlyph(note.hit, point.x, point.y, startAngle, hue, alpha, note.velocity, energy);
        continue;
      }

      const layers = Math.max(1, this.identity.echoLayers);
      for (let layer = layers - 1; layer >= 0; layer -= 1) {
        const echo = layer / Math.max(1, layers - 1);
        const layerRadius = radial * (1 - echo * (this.identity.geometry === 'echo' ? 0.12 : 0.045));
        const layerAlpha = alpha * (1 - echo * 0.64);
        const layerHue = (hue + echo * 18) % 360;
        this.strokeSemanticArc(startAngle, endAngle, layerRadius, cx, cy, layerHue, layerAlpha, weight * (1 - echo * 0.28));
      }

      const head = this.fieldPoint(endAngle, radial, cx, cy);
      const node = (1.4 + note.velocity * 4.2 + energy * 3) * (0.65 + this.intensity * 0.5);
      ctx.fillStyle = `hsla(${hue}, 94%, 80%, ${Math.min(0.92, alpha * 1.25)})`;
      ctx.beginPath();
      ctx.arc(head.x, head.y, node, 0, TAU);
      ctx.fill();
    }
  }

  private strokeSemanticArc(start: number, end: number, radius: number, cx: number, cy: number, hue: number, alpha: number, weight: number): void {
    const ctx = this.ctx;
    const segments = Math.max(4, Math.ceil(Math.abs(end - start) * 22));
    ctx.strokeStyle = `hsla(${hue}, 86%, 72%, ${Math.min(0.88, alpha)})`;
    ctx.lineWidth = Math.max(0.7, weight);
    ctx.lineCap = this.identity.geometry === 'circuit' ? 'square' : 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      let angle = start + (end - start) * t;
      let r = radius;

      if (this.identity.geometry === 'fracture') {
        const fracture = Math.sin((angle + radius * 0.01) * 7) * this.identity.angularWarp;
        angle += fracture * (i % 2 ? 1 : -0.45);
        r *= 1 + Math.sin(i * 2.7 + radius) * 0.022;
      } else if (this.identity.geometry === 'nebula') {
        r *= 1 + Math.sin(angle * 3 + radius * 0.02) * 0.025 * this.style.motion;
      } else if (this.identity.geometry === 'echo') {
        angle += Math.sin(angle * 2) * this.identity.angularWarp;
      }

      const p = this.fieldPoint(angle, r, cx, cy);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  private fieldPoint(angle: number, radius: number, cx: number, cy: number): { x: number; y: number } {
    let r = radius;
    let a = angle;

    if (this.identity.geometry === 'circuit') {
      const sides = 12;
      const sector = TAU / sides;
      const local = ((a + sector / 2) % sector + sector) % sector - sector / 2;
      r = r * Math.cos(sector / 2) / Math.max(0.55, Math.cos(local));
    }

    if (this.identity.geometry === 'fracture') {
      a += Math.sin(a * 5 + radius * 0.015) * this.identity.angularWarp * 0.45;
    }

    const tilt = this.fieldTilt();
    const x0 = Math.cos(a) * r;
    const y0 = Math.sin(a) * r * this.verticalScale();
    return {
      x: cx + x0 * Math.cos(tilt) - y0 * Math.sin(tilt),
      y: cy + x0 * Math.sin(tilt) + y0 * Math.cos(tilt),
    };
  }

  private fieldGeometry(): { x: number; y: number; radius: number } {
    return {
      x: this.width * 0.52,
      y: this.height * 0.53,
      radius: Math.min(this.width, this.height) * 0.37,
    };
  }

  private verticalScale(): number {
    if (this.identity.geometry === 'nebula') return 0.58;
    if (this.identity.geometry === 'echo') return 0.78;
    if (this.identity.geometry === 'circuit') return 0.82;
    return 0.72 + this.style.orbit * 0.10;
  }

  private fieldTilt(): number {
    if (this.identity.geometry === 'nebula') return -0.26;
    if (this.identity.geometry === 'fracture') return 0.08;
    return -0.12;
  }

  private percussionPitch(hit?: PercHit): number {
    if (hit === 'kick') return 30;
    if (hit === 'snare') return 54;
    if (hit === 'rim') return 68;
    return 84;
  }

  private drawPercussionGlyph(hit: PercHit, x: number, y: number, angle: number, hue: number, alpha: number, velocity: number, energy: number): void {
    const ctx = this.ctx;
    const size = (3 + velocity * 8 + energy * 4) * (0.6 + this.intensity * 0.55);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = `hsla(${hue}, 78%, 76%, ${Math.min(0.9, alpha * 1.25)})`;
    ctx.fillStyle = `hsla(${hue}, 88%, 78%, ${Math.min(0.75, alpha)})`;
    ctx.lineWidth = 1.2 + velocity * 1.4;

    if (hit === 'kick') {
      ctx.beginPath(); ctx.arc(0, 0, size, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, Math.max(1, size * 0.28), 0, TAU); ctx.fill();
    } else if (hit === 'snare') {
      ctx.rotate(Math.PI / 4); ctx.strokeRect(-size * 0.7, -size * 0.7, size * 1.4, size * 1.4);
    } else if (hit === 'hat') {
      ctx.beginPath(); ctx.moveTo(-size, 0); ctx.lineTo(size, 0); ctx.moveTo(0, -size); ctx.lineTo(0, size); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(-size, 0); ctx.lineTo(size, 0); ctx.stroke();
    }
    ctx.restore();
  }

  private drawLinearFurniture(energy: number): void {
    const ctx = this.ctx;
    const anchor = this.anchor;
    const bars = anchor?.bars ?? 4;
    ctx.save();
    ctx.strokeStyle = `rgba(122, 92, 255, ${(0.1 + energy * 0.06).toFixed(3)})`;
    ctx.lineWidth = 1;
    for (let bar = 1; bar < bars; bar += 1) {
      const x = (bar / bars) * this.width;
      ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, this.height - 6); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(120, 160, 220, 0.09)';
    const divider = this.height * 0.765;
    ctx.beginPath(); ctx.moveTo(0, divider); ctx.lineTo(this.width, divider); ctx.stroke();
    ctx.restore();
  }

  private drawLinearNote(note: TrackedNote, now: number, energy: number): void {
    const ctx = this.ctx;
    const elapsed = now - note.time;
    if (elapsed < 0) return;
    const span = Math.max(note.duration, 0.05);
    const progress = Math.min(1, elapsed / span);
    const stepWidth = this.width / Math.max(1, note.totalSteps);
    const x0 = note.loopStep * stepWidth;
    const fullWidth = Math.max(stepWidth * 0.5, note.steps * stepWidth);
    const drawnWidth = Math.max(2, fullWidth * progress);
    const hue = (this.style.hue + this.identity.hueShift + note.voice * 28) % 360;
    const alpha = (0.32 + note.velocity * 0.5) * (0.55 + this.intensity * 0.45);
    const glow = 0.5 + energy * 0.5;

    if (note.kind === 'perc' && note.hit) {
      if (note.ringDrawn) return;
      const y = percY(note.hit, this.height);
      const size = (4 + note.velocity * 9) * (0.6 + this.intensity * 0.8);
      ctx.fillStyle = `hsla(${hue}, 55%, ${(72 + glow * 16).toFixed(0)}%, ${alpha.toFixed(3)})`;
      ctx.fillRect(x0 - 1.5, y - size / 2, 3, size);
      this.drawRing(x0, y, 4 + note.velocity * 12, hue, alpha);
      note.ringDrawn = true;
      note.drawn = 1;
      return;
    }

    const fromX = x0 + fullWidth * note.drawn;
    const toX = x0 + drawnWidth;
    if (toX - fromX < 0.05 && note.ringDrawn) return;

    note.pitches.forEach((midi) => {
      const y = pitchY(midi, this.height);
      const thickness = (note.kind === 'bass' ? 5 : 2.6) * (0.7 + this.intensity * 0.6);
      const wobble = this.reducedMotion ? 0 : Math.sin((note.time + midi) * 3.1 + now * 1.7) * 0.6;
      ctx.strokeStyle = `hsla(${hue}, ${note.kind === 'bass' ? 72 : 88}%, ${(58 + glow * 22).toFixed(0)}%, ${alpha.toFixed(3)})`;
      ctx.lineWidth = thickness;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fromX, y + wobble); ctx.lineTo(toX, y + wobble); ctx.stroke();
      if (!note.ringDrawn) this.drawRing(x0, y, 5 + note.velocity * 16, hue, alpha);
    });
    note.ringDrawn = true;
    note.drawn = progress;
  }

  private drawRing(x: number, y: number, radius: number, hue: number, alpha: number): void {
    const ctx = this.ctx;
    const scale = this.reducedMotion ? 0.55 : 1;
    ctx.strokeStyle = `hsla(${hue}, 90%, 78%, ${(alpha * 0.55).toFixed(3)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, radius * scale * (0.5 + this.intensity * 0.7)), 0, TAU);
    ctx.stroke();
  }

  private drawPlayhead(phase: number, energy: number): void {
    const ctx = this.ctx;
    const x = phase * this.width;
    const alpha = 0.22 + energy * 0.25 * (0.4 + this.intensity * 0.6);
    ctx.save();
    ctx.strokeStyle = `rgba(190, 225, 255, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.height); ctx.stroke();
    ctx.restore();
  }

  private drawImperfection(now: number, energy: number): void {
    const ctx = this.ctx;
    const strength = this.intensity * (this.reducedMotion ? 0.35 : 1);
    if (strength <= 0.01) return;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(150, 190, 255, ${(0.009 * strength).toFixed(4)})`;
    const drift = this.reducedMotion ? 0 : (now * 10) % 4;
    for (let y = drift; y < this.height; y += 4) ctx.fillRect(0, y, this.width, 1);

    const vignette = ctx.createRadialGradient(
      this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.2,
      this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.72,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, `rgba(0,0,0,${(0.5 - energy * 0.12).toFixed(3)})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  private prune(now: number): void {
    const cutoff = now - 8;
    if (this.notes.length && this.notes[0]!.time < cutoff) {
      this.notes = this.notes.filter((note) => note.time + note.duration > cutoff);
    }
  }
}
