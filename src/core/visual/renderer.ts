/**
 * The visual system.
 *
 * One rule decides everything on screen: the picture is the score, drawn in audio time.
 *
 *   horizontal   position in the loop (left edge is bar 1 beat 1, the sweep line is now)
 *   vertical     pitch, MIDI 24 at the floor to MIDI 96 at the ceiling; percussion has its
 *                own lanes in the band below the pitch field
 *   length       duration — a note draws itself while it sounds, so a held note leaves a
 *                longer trail than a short one
 *   colour       voice identity: tonal voices are icy blue, bass is violet, percussion is pale
 *   pulse        a ring on every attack, sized by velocity
 *   brightness   short-term audio energy from the analyser, so what you see is what is
 *                actually coming out
 *   persistence  the `memory` control: how slowly the frame fades, i.e. how long traces last
 *
 * Note geometry comes from the scheduled musical events, never from the analyser, so a quiet
 * note is still exactly where the music put it. The analyser only moves brightness and drift.
 */

import { DEFAULT_STYLE, type Style } from '../learning/visualModel';
import type { PercHit, VoiceKind } from '../pattern/types';

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
  /** Duration in steps, which is what the horizontal length is drawn from. */
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

interface TrackedNote extends VisualNote {
  /** Last drawn progress 0..1, so each frame only extends the trail. */
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

/**
 * Where one musical event lands. Pitch, step, duration and voice kind are the only inputs,
 * so the picture cannot drift away from the score.
 */
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

export class Visualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly now: () => number;
  private readonly energy: () => number;

  private style: Style = { ...DEFAULT_STYLE };
  setStyle(style: Style): void { this.style = { ...style }; }

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

  setMemory(value: number): void {
    this.memory = Math.min(1, Math.max(0, value));
  }

  setIntensity(value: number): void {
    this.intensity = Math.min(1, Math.max(0, value));
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
  }

  setAnchor(anchor: TimelineAnchor): void {
    this.anchor = anchor;
  }

  pushNotes(notes: VisualNote[]): void {
    notes.forEach((note) => {
      this.notes.push({ ...note, drawn: 0, ringDrawn: false });
    });
    if (this.notes.length > MAX_TRACKED_NOTES) {
      this.notes.splice(0, this.notes.length - MAX_TRACKED_NOTES);
    }
  }

  clearNotes(): void {
    this.notes = [];
    this.anchor = null;
  }

  /** Wipe the canvas to the backdrop. Used by Kill and by Stop. */
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

    // Persistence: `memory` at 0 wipes almost every frame, at 1 it barely fades at all.
    const fade = 0.30 - (this.memory * 0.3 + this.style.trails * 0.7) * 0.275;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(5, 5, 12, ${fade.toFixed(3)})`;
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.style.orbit < 0.15) this.drawFrameFurniture(energy);

    const phase = this.loopPhase(now);
    this.prune(now);

    ctx.globalCompositeOperation = 'lighter';
    if (this.style.orbit < 0.15) this.notes.forEach((note) => this.drawNote(note, now, energy));
    else this.drawConstellation(now, energy);
    ctx.globalCompositeOperation = 'source-over';

    if (phase !== null && this.style.orbit < 0.15) this.drawPlayhead(phase, energy);
    this.drawImperfection(now, energy);
  }

  /** Geometry follows actual scheduled notes. Learned style changes the drawing parameters. */
  private drawConstellation(now: number, energy: number): void {
    const ctx = this.ctx;
    const active = this.notes.filter(n => now >= n.time && now < n.time + n.duration + 0.75).slice(-96);
    const cx = this.width / 2, cy = this.height / 2;
    const radius = Math.min(this.width, this.height) * (0.16 + this.style.spread * 0.26);
    const movement = this.reducedMotion ? 0 : this.style.motion;
    // A quiet outline makes the instrument visible before the first note, without fake audio activity.
    ctx.strokeStyle = `hsla(${this.style.hue}, 65%, 65%, .10)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, cy, radius * 1.35, radius, -.25, 0, Math.PI * 2); ctx.stroke();
    let previous: {x: number; y: number} | null = null;
    for (const note of active) {
      const age = now - note.time;
      const fade = Math.max(0, 1 - Math.max(0, age - note.duration) / .75);
      const pitch = note.pitches[0] ?? (note.hit === 'kick' ? 32 : note.hit === 'snare' ? 58 : 82);
      const angle = note.loopStep / note.totalSteps * Math.PI * 2 - Math.PI / 2 + now * movement * .09;
      const r = radius * (.35 + Math.max(0, Math.min(1, (pitch - 12) / 96)));
      const orbitX = cx + Math.cos(angle) * r * (1.25 + note.voice * .06);
      const orbitY = cy + Math.sin(angle) * r;
      const linearX = this.width * (.08 + .84 * note.loopStep / note.totalSteps);
      const linearY = this.height * (.85 - .7 * (pitch - 12) / 96);
      const blend = this.style.orbit;
      const x = linearX * (1 - blend) + orbitX * blend;
      const y = linearY * (1 - blend) + orbitY * blend;
      const hue = (this.style.hue + note.voice * 28) % 360;
      const alpha = fade * (.20 + note.velocity * .45) * (.25 + this.intensity * .75);
      ctx.strokeStyle = `hsla(${hue}, 85%, 72%, ${alpha * .5})`;
      if (previous) { ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.quadraticCurveTo(cx, cy, x, y); ctx.stroke(); }
      ctx.fillStyle = `hsla(${hue}, 90%, 78%, ${alpha})`;
      const size = (2 + note.velocity * 5 + energy * 8) * (.5 + this.intensity * .5);
      ctx.beginPath(); ctx.arc(x,y,size,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(x,y,size + 4 + (this.reducedMotion ? 0 : Math.min(age,1) * 22 * movement),0,Math.PI*2); ctx.stroke();
      previous = {x,y};
    }
  }

  private loopPhase(now: number): number | null {
    const anchor = this.anchor;
    if (!anchor || anchor.secondsPerBar <= 0 || anchor.bars <= 0) return null;
    const barProgress = (now - anchor.time) / anchor.secondsPerBar;
    const position = (anchor.bar + Math.max(0, barProgress)) / anchor.bars;
    return position - Math.floor(position);
  }

  private drawFrameFurniture(energy: number): void {
    const ctx = this.ctx;
    const anchor = this.anchor;
    const bars = anchor?.bars ?? 4;
    ctx.save();
    ctx.strokeStyle = `rgba(122, 92, 255, ${(0.1 + energy * 0.06).toFixed(3)})`;
    ctx.lineWidth = 1;
    for (let bar = 1; bar < bars; bar += 1) {
      const x = (bar / bars) * this.width;
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x, this.height - 6);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(120, 160, 220, 0.09)';
    const divider = this.height * 0.765;
    ctx.beginPath();
    ctx.moveTo(0, divider);
    ctx.lineTo(this.width, divider);
    ctx.stroke();
    ctx.restore();
  }

  private drawNote(note: TrackedNote, now: number, energy: number): void {
    const ctx = this.ctx;
    const elapsed = now - note.time;
    if (elapsed < 0) return;
    const span = Math.max(note.duration, 0.05);
    const progress = Math.min(1, elapsed / span);
    const stepWidth = this.width / Math.max(1, note.totalSteps);
    const x0 = note.loopStep * stepWidth;
    const fullWidth = Math.max(stepWidth * 0.5, note.steps * stepWidth);
    const drawnWidth = Math.max(2, fullWidth * progress);
    const hue = (this.style.hue + note.voice * 28) % 360;
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

    // Only the newly sounded part of the note is painted each frame. The rest is still on the
    // canvas from earlier frames, fading at whatever rate `memory` asks for, which is what makes
    // a long note leave a long trail instead of a saturated white bar.
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
      ctx.beginPath();
      ctx.moveTo(fromX, y + wobble);
      ctx.lineTo(toX, y + wobble);
      ctx.stroke();
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
    ctx.arc(x, y, Math.max(2, radius * scale * (0.5 + this.intensity * 0.7)), 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawPlayhead(phase: number, energy: number): void {
    const ctx = this.ctx;
    const x = phase * this.width;
    const alpha = 0.22 + energy * 0.25 * (0.4 + this.intensity * 0.6);
    ctx.save();
    ctx.strokeStyle = `rgba(190, 225, 255, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.height);
    ctx.stroke();
    ctx.restore();
  }

  /** Scanlines, a slow drift and a vignette. Muted hard when reduced motion is on. */
  private drawImperfection(now: number, energy: number): void {
    const ctx = this.ctx;
    const strength = this.intensity * (this.reducedMotion ? 0.35 : 1);
    if (strength <= 0.01) return;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(150, 190, 255, ${(0.012 * strength).toFixed(4)})`;
    const drift = this.reducedMotion ? 0 : (now * 14) % 4;
    for (let y = drift; y < this.height; y += 4) {
      ctx.fillRect(0, y, this.width, 1);
    }

    const vignette = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.2,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.72,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, `rgba(0,0,0,${(0.5 - energy * 0.12).toFixed(3)})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  private prune(now: number): void {
    const cutoff = now - 6;
    if (this.notes.length && (this.notes[0] as TrackedNote).time < cutoff) {
      this.notes = this.notes.filter((note) => note.time + note.duration > cutoff);
    }
  }
}
