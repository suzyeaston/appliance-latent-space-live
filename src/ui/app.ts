/**
 * Application wiring.
 *
 * This file owns the browser: DOM, the audio context lifecycle, timers, files. Everything
 * musical it delegates — parsing to `core/pattern`, time to `core/sequencer`, sound to
 * `core/audio`, picture to `core/visual`, vocabulary to `core/control-map`. Those modules do not
 * import this one, which is what keeps a future MIDI or AI adapter from having to go through the
 * user interface to reach the instrument.
 */

import rawControlMap from '../core/control-map/control-map.json';
import { AudioEngine } from '../core/audio/engine';
import {
  normalizeControlMap,
  createControlState,
  resolveKeyBinding,
  type ControlEvent,
  type ControlState,
} from '../core/control-map/controlMap';
import { controlStatus } from '../core/control-map/status';
import { EXAMPLES, defaultExample } from '../core/pattern/examples';
import { parsePattern } from '../core/pattern/parse';
import { secondsPerStep, type PatternIssue, type Score } from '../core/pattern/types';
import { createProject, importProject, serializeProject, type ProjectFile } from '../core/project/project';
import { ProjectStore } from '../core/project/storage';
import { variationProvider } from '../core/proposals/variation';
import type { Proposal } from '../core/proposals/types';
import { Sequencer, type BarEvent, type ScheduledNote } from '../core/sequencer';
import { DJ } from './dj';
import { Studio } from './studio';
import { formatScore } from '../core/pattern/format';
import { Visualizer } from '../core/visual/renderer';
import { ControlSurface } from './controlSurface';
import { clear, el, formatValue, make } from './dom';

const SCHEDULER_INTERVAL_MS = 40;
const EDIT_DEBOUNCE_MS = 450;
const AUTOSAVE_DEBOUNCE_MS = 1500;

type PatternState = 'idle' | 'playing' | 'queued' | 'invalid' | 'auditioning';

export class App {
  private readonly map = normalizeControlMap(rawControlMap);
  private readonly controlState: ControlState;
  private readonly store = new ProjectStore();
  private readonly surface: ControlSurface;
  private readonly visualizer: Visualizer;
  private readonly sequencer: Sequencer;

  private studio?: Studio;
  private dj?: DJ;

  private context: AudioContext | null = null;
  private engine: AudioEngine | null = null;
  private schedulerTimer = 0;

  private activeSource = '';
  private lastValidScore: Score;
  private editTimer = 0;
  private autosaveTimer = 0;
  private patternState: PatternState = 'idle';

  private masterVolume = 0.5;
  private visualIntensity = 0.7;
  private reducedMotion = false;
  private performanceMode = false;
  private heldKeys = new Set<string>();

  private proposal: Proposal | null = null;
  private proposalSeed = 0;
  private auditioning = false;
  private patternBeforeProposal: string | null = null;
  private capture: { pattern: string; controls: ControlState; at: Date } | null = null;

  private savedSignature = '';
  private lastSavedAt: Date | null = null;

  // Elements
  private readonly editor = el<HTMLTextAreaElement>('editor');
  private readonly diagnostics = el<HTMLDivElement>('diagnostics');
  private readonly patternTag = el<HTMLSpanElement>('pattern-state');
  private readonly audioStatus = el<HTMLParagraphElement>('audio-status');
  private readonly positionReadout = el<HTMLSpanElement>('position-readout');
  private readonly playingReadout = el<HTMLSpanElement>('playing-readout');
  private readonly startButton = el<HTMLButtonElement>('start');
  private readonly stopButton = el<HTMLButtonElement>('stop');
  private readonly killButton = el<HTMLButtonElement>('kill');
  private readonly titleInput = el<HTMLInputElement>('title');
  private readonly saveTag = el<HTMLSpanElement>('save-state');
  private readonly projectMessage = el<HTMLParagraphElement>('project-message');
  private readonly proposalPanel = el<HTMLDivElement>('proposal');
  private readonly proposalTag = el<HTMLSpanElement>('proposal-state');
  private readonly auditionButton = el<HTMLButtonElement>('audition');
  private readonly revertButton = el<HTMLButtonElement>('revert');

  constructor() {
    const restored = this.store.load();
    const example = defaultExample();
    const startingPattern = restored?.pattern ?? example.source;

    const parsed = parsePattern(startingPattern);
    if (parsed.ok) {
      this.lastValidScore = parsed.score;
    } else {
      // A corrupted autosave must never stop the instrument from opening.
      const fallback = parsePattern(example.source);
      if (!fallback.ok) throw new Error('The built-in example does not parse. This is a build error.');
      this.lastValidScore = fallback.score;
    }

    this.controlState = createControlState(this.map);
    if (restored) {
      Object.entries(restored.controls).forEach(([id, value]) => {
        if (id in this.controlState) this.controlState[id] = value;
      });
      this.masterVolume = restored.master;
      this.visualIntensity = restored.visualIntensity;
      this.reducedMotion = restored.reducedMotion;
      this.titleInput.value = restored.title;
      this.lastSavedAt = new Date(restored.savedAt);
    }

    this.editor.value = startingPattern;
    this.activeSource = parsed.ok ? startingPattern : example.source;

    this.sequencer = new Sequencer(this.lastValidScore, {
      now: () => this.audioNow(),
      beforeBar: () => {
        const text = this.dj?.nextTimelineBar();
        if (!text) return null;
        const parsed = parsePattern(text);
        if (!parsed.ok) { this.dj?.stopTimeline(); return null; }
        this.editor.value = text;
        this.lastValidScore = parsed.score;
        this.activeSource = text;
        this.queueAutosave();
        return parsed.score;
      },
      onNotes: (notes) => this.handleNotes(notes),
      onBar: (bar) => this.handleBar(bar),
    });

    this.visualizer = new Visualizer(el<HTMLCanvasElement>('stage'), {
      now: () => this.audioNow(),
      energy: () => this.engine?.energy() ?? 0,
    });
    this.visualizer.setMemory(this.controlState['memory'] ?? 0.25);
    this.visualizer.setIntensity(this.visualIntensity);

    this.surface = new ControlSurface(el<HTMLDivElement>('controls'), {
      map: this.map,
      state: this.controlState,
      onEvent: (event) => this.applyControlEvent(event),
      now: () => this.audioNow(),
    });

    this.buildExamples();
    this.wireTransport();
    this.wireEditor();
    this.wireView();
    this.wireProject();
    this.wireProposals();
    this.wireKeyboard();

    el<HTMLSpanElement>('control-map-version').textContent = `map v${this.map.schemaVersion}`;
    el<HTMLParagraphElement>('provider-description').textContent =
      `${variationProvider.label}: ${variationProvider.description}`;

    Object.entries(this.controlState).forEach(([id, value]) => this.surface.reflect(id, value));
    this.renderKeyHints();
    this.setMasterVolume(this.masterVolume, true);
    el<HTMLInputElement>('intensity').value = String(this.visualIntensity);
    el<HTMLOutputElement>('intensity-readout').textContent = formatValue(this.visualIntensity);
    el<HTMLInputElement>('reduced-motion').checked = this.reducedMotion;
    this.visualizer.setReducedMotion(this.reducedMotion);

    if (!this.store.available) {
      this.saveTag.textContent = 'autosave unavailable';
      this.saveTag.className = 'tag tag--bad';
      this.projectMessage.textContent =
        'This browser is blocking local storage, so autosave is off. Use Export JSON to keep your work.';
    } else if (restored) {
      this.saveTag.textContent = `restored from autosave`;
    }

    this.savedSignature = this.signature();
    this.validate({ queue: false });
    this.studio = new Studio({
      score: () => this.sequencer.isRunning ? this.sequencer.activeScore : this.lastValidScore,
      controls: () => this.controlState,
      style: style => this.visualizer.setStyle(style),
      edit: (tempo, voice, level) => {
        const parsed = parsePattern(this.editor.value);
        if (!parsed.ok) return false;
        if (tempo !== null) parsed.score.tempo = tempo;
        if (voice !== null && level !== null && parsed.score.voices[voice]) parsed.score.voices[voice]!.level = level;
        this.setEditorValue(formatScore(parsed.score));
        return true;
      },
    });
    this.dj = new DJ({source: () => this.editor.value, load: pattern => this.setEditorValue(pattern), running: () => this.sequencer.isRunning, start: async () => {
      this.controlState['freeze'] = 0;
      this.surface.reflect('freeze', 0);
      this.sequencer.setFrozen(false);
      await this.start();
      return this.sequencer.isRunning;
    }});
    this.visualizer.start();
    window.addEventListener('resize', () => this.visualizer.resize());
    window.addEventListener('beforeunload', (event) => {
      if (this.dirty()) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches && !restored) {
      el<HTMLInputElement>('reduced-motion').checked = true;
      this.reducedMotion = true;
      this.visualizer.setReducedMotion(true);
    }
  }

  // ---------------------------------------------------------------- audio lifecycle

  private audioNow(): number {
    return this.context ? this.context.currentTime : performance.now() / 1000;
  }

  private async start(): Promise<void> {
    if (this.sequencer.isRunning) return;
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.setAudioStatus('This browser has no Web Audio support, so the instrument cannot make sound.', 'warn');
        return;
      }
      this.context = new Ctor({ latencyHint: 'interactive' });
      this.context.addEventListener('statechange', () => this.reportAudioState());
      this.engine = new AudioEngine(this.context, { analyse: true });
      this.pushAllControlsToEngine();
    }

    try {
      if (this.context.state !== 'running') await this.context.resume();
    } catch {
      this.setAudioStatus('The browser refused to start audio. Click Start again.', 'warn');
      return;
    }

    this.engine?.setTempo(this.sequencer.activeScore.tempo);
    this.sequencer.start(this.context.currentTime);
    if (!this.schedulerTimer) {
      this.schedulerTimer = window.setInterval(() => this.sequencer.tick(), SCHEDULER_INTERVAL_MS);
    }
    this.startButton.disabled = true;
    this.stopButton.disabled = false;
    this.killButton.disabled = false;
    this.setPatternState('playing');
    this.reportAudioState();
  }

  private stop(): void {
    this.dj?.stopTimeline(true);
    this.sequencer.stop();
    if (this.schedulerTimer) {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = 0;
    }
    this.engine?.kill();
    this.visualizer.clearNotes();
    this.auditioning = false;
    this.updateAuditionButton();
    this.startButton.disabled = false;
    this.stopButton.disabled = true;
    this.killButton.disabled = true;
    this.setPatternState('idle');
    this.positionReadout.textContent = 'bar — / —';
    this.playingReadout.textContent = 'nothing playing';
    this.reportAudioState();
  }

  /** kill: everything stops, right now. */
  private killAll(): void {
    this.dj?.stopTimeline(true);
    this.engine?.kill();
    this.sequencer.stop();
    if (this.schedulerTimer) {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = 0;
    }
    this.visualizer.clearNotes();
    this.visualizer.wipe();
    this.auditioning = false;
    this.updateAuditionButton();
    this.startButton.disabled = false;
    this.stopButton.disabled = true;
    this.killButton.disabled = true;
    this.setPatternState('idle');
    this.positionReadout.textContent = 'bar — / —';
    this.playingReadout.textContent = 'killed';
    this.setAudioStatus('Killed. Every scheduled note was dropped and the delay line was emptied.', 'warn');
  }

  private reportAudioState(): void {
    if (!this.context) {
      this.setAudioStatus('Audio is not running. Nothing will sound until you press Start.', 'idle');
      return;
    }
    if (this.context.state === 'suspended') {
      this.setAudioStatus('The browser has suspended audio for this tab. Press Start to resume it.', 'warn');
      return;
    }
    if (this.context.state === 'closed') {
      this.setAudioStatus('The audio context was closed. Reload the page to play again.', 'warn');
      return;
    }
    if (!this.sequencer.isRunning) {
      this.setAudioStatus('Audio is live and silent. Press Start to run the loop.', 'idle');
      return;
    }
    const rate = Math.round(this.context.sampleRate / 100) / 10;
    this.setAudioStatus(`Audio running at ${rate} kHz. Output is limited and the master fader is capped.`, 'live');
  }

  private setAudioStatus(text: string, tone: 'idle' | 'live' | 'warn'): void {
    this.audioStatus.textContent = text;
    this.audioStatus.dataset['tone'] = tone;
  }

  // ---------------------------------------------------------------- musical events

  private handleNotes(notes: ScheduledNote[]): void {
    const score = this.sequencer.activeScore;
    notes.forEach((note) => {
      const voice = score.voices[note.event.voice];
      if (!voice) return;
      this.engine?.play(note, voice, 1);
      this.visualizer.pushNotes([
        {
          voice: note.event.voice,
          kind: voice.kind,
          pitches: note.event.pitches,
          velocity: voice.muted ? 0.12 : note.event.velocity,
          time: note.time,
          duration: note.duration,
          loopStep: note.loopStep,
          steps: note.event.steps,
          totalSteps: score.totalSteps,
          ...(note.event.hit ? { hit: note.event.hit } : {}),
        },
      ]);
    });
  }

  private handleBar(bar: BarEvent): void {
    this.studio?.refresh();
    const score = this.sequencer.activeScore;
    this.visualizer.setAnchor({
      time: bar.time,
      bar: bar.bar,
      bars: bar.bars,
      secondsPerBar: secondsPerStep(score.tempo, score.grid) * score.grid,
    });
    this.positionReadout.textContent = `bar ${bar.bar + 1} / ${bar.bars} · ${score.tempo} bpm · grid ${score.grid}`;
    if (bar.applied) {
      this.engine?.setTempo(score.tempo);
      this.activeSource = score.source;
      this.setPatternState(this.auditioning ? 'auditioning' : 'playing');
    }
    this.playingReadout.textContent = this.auditioning
      ? 'auditioning a proposal — your pattern is untouched'
      : `${score.voices.length} voices · ${score.events.length} notes`;
  }

  // ---------------------------------------------------------------- controls

  private applyControlEvent(event: ControlEvent): void {
    if (controlStatus(event.id).state !== 'active') return;
    this.controlState[event.id] = event.value;
    this.surface.reflect(event.id, event.value);
    this.studio?.refresh();

    switch (event.id) {
      case 'browning':
        this.engine?.setBrowning(event.value);
        break;
      case 'destruction':
        this.engine?.setDestruction(event.value);
        break;
      case 'memory':
        this.engine?.setMemory(event.value);
        this.visualizer.setMemory(event.value);
        break;
      case 'freeze':
        this.dj?.stopTimeline();
        this.sequencer.setFrozen(event.value >= 0.5);
        break;
      case 'plunge':
        if (event.value >= 0.5) {
          if (this.sequencer.isRunning) {
            this.sequencer.retrigger(this.audioNow());
          } else {
            void this.start();
          }
        }
        break;
      case 'capture':
        if (event.value >= 0.5) this.takeCapture();
        break;
      case 'kill':
        if (event.value >= 0.5) this.killAll();
        break;
      default:
        break;
    }
    this.queueAutosave();
  }

  private pushAllControlsToEngine(): void {
    const engine = this.engine;
    if (!engine) return;
    engine.setMasterVolume(this.masterVolume);
    engine.setBrowning(this.controlState['browning'] ?? 0.35);
    engine.setDestruction(this.controlState['destruction'] ?? 0);
    engine.setMemory(this.controlState['memory'] ?? 0.25);
    this.sequencer.setFrozen((this.controlState['freeze'] ?? 0) >= 0.5);
  }

  private takeCapture(): void {
    this.capture = {
      pattern: this.editor.value,
      controls: { ...this.controlState },
      at: new Date(),
    };
    this.renderCaptureRow();
  }

  private renderCaptureRow(): void {
    const container = el<HTMLDivElement>('controls');
    let row = container.querySelector<HTMLDivElement>('[data-capture-row]');
    if (!row) {
      row = make('div', { className: 'row', attrs: { 'data-capture-row': 'true' } });
      container.appendChild(row);
    }
    clear(row);
    if (!this.capture) return;
    const stamp = this.capture.at.toLocaleTimeString();
    row.appendChild(make('span', { className: 'row__label', text: `captured ${stamp}` }));
    const recall = make('button', { className: 'btn btn--small btn--ghost', text: 'Recall capture', attrs: { type: 'button' } });
    recall.addEventListener('click', () => this.recallCapture());
    row.appendChild(recall);
  }

  private recallCapture(): void {
    const snapshot = this.capture;
    if (!snapshot) return;
    if (this.editor.value !== snapshot.pattern && !this.confirmReplace('Recall the captured position?')) return;
    Object.entries(snapshot.controls).forEach(([id, value]) => {
      this.controlState[id] = value;
      this.surface.reflect(id, value);
      if (controlStatus(id).state === 'active') {
        this.applyControlEvent({ id, kind: 'continuous', group: '', value, source: 'pointer', at: this.audioNow() });
      }
    });
    this.setEditorValue(snapshot.pattern);
  }

  // ---------------------------------------------------------------- editor

  private wireEditor(): void {
    this.editor.addEventListener('input', () => {
      this.dj?.stopTimeline();
      window.clearTimeout(this.editTimer);
      this.editTimer = window.setTimeout(() => this.validate({ queue: true }), EDIT_DEBOUNCE_MS);
      this.queueAutosave();
    });

    this.editor.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        window.clearTimeout(this.editTimer);
        this.validate({ queue: true });
      }
    });
  }

  private validate(options: { queue: boolean }): void {
    const text = this.editor.value;
    const result = parsePattern(text);
    clear(this.diagnostics);

    if (!result.ok) {
      result.errors.slice(0, 8).forEach((issue) => this.diagnostics.appendChild(this.issueRow(issue, 'error')));
      if (result.errors.length > 8) {
        this.diagnostics.appendChild(
          make('div', { className: 'diag', text: `…and ${result.errors.length - 8} more.` }),
        );
      }
      this.setPatternState('invalid');
      return;
    }

    result.warnings.slice(0, 4).forEach((issue) => this.diagnostics.appendChild(this.issueRow(issue, 'warn')));
    this.lastValidScore = result.score;
    this.studio?.refresh();

    if (!options.queue) {
      this.setPatternState(this.sequencer.isRunning ? 'playing' : 'idle');
      return;
    }
    if (text === this.activeSource) {
      this.setPatternState(this.sequencer.isRunning ? (this.auditioning ? 'auditioning' : 'playing') : 'idle');
      return;
    }

    if (this.auditioning) {
      // Editing while a proposal is auditioning ends the audition: the player is back on
      // their own material and the proposal stays available in its panel.
      this.auditioning = false;
      this.updateAuditionButton();
    }

    const outcome = this.sequencer.setScore(result.score);
    if (outcome === 'applied') {
      this.activeSource = text;
      this.engine?.setTempo(result.score.tempo);
      this.setPatternState(this.sequencer.isRunning ? 'playing' : 'idle');
    } else {
      this.setPatternState('queued');
    }
  }

  private issueRow(issue: PatternIssue, tone: 'error' | 'warn'): HTMLElement {
    const row = make('button', {
      className: tone === 'warn' ? 'diag diag--warn' : 'diag',
      attrs: { type: 'button' },
    });
    row.appendChild(make('span', { className: 'diag__where', text: `${issue.line}:${issue.column}` }));
    row.appendChild(make('span', { text: issue.message }));
    if (issue.hint) row.appendChild(make('span', { className: 'diag__hint', text: issue.hint }));
    row.addEventListener('click', () => this.jumpTo(issue));
    return row;
  }

  private jumpTo(issue: PatternIssue): void {
    const lines = this.editor.value.split('\n');
    let offset = 0;
    for (let i = 0; i < issue.line - 1 && i < lines.length; i += 1) {
      offset += (lines[i] as string).length + 1;
    }
    const start = offset + Math.max(0, issue.column - 1);
    this.editor.focus();
    this.editor.setSelectionRange(start, start + Math.max(1, issue.length));
  }

  private setPatternState(state: PatternState): void {
    this.patternState = state;
    const invalidLabel = this.sequencer.isRunning
      ? 'invalid — last valid pattern still playing'
      : 'invalid — fix it before it can play';
    const labels: Record<PatternState, [string, string]> = {
      idle: ['ready — press Start', 'tag tag--quiet'],
      playing: ['playing this pattern', 'tag tag--live'],
      queued: ['edit waiting for the next bar line', 'tag tag--pending'],
      invalid: [invalidLabel, 'tag tag--bad'],
      auditioning: ['auditioning a proposal', 'tag tag--pending'],
    };
    const [text, className] = labels[state];
    this.patternTag.textContent = text;
    this.patternTag.className = className;
  }

  private setEditorValue(text: string): void {
    this.dj?.stopTimeline();
    this.editor.value = text;
    window.clearTimeout(this.editTimer);
    this.validate({ queue: true });
    this.queueAutosave();
  }

  // ---------------------------------------------------------------- transport, view, keys

  private wireTransport(): void {
    this.startButton.addEventListener('click', () => void this.start());
    this.stopButton.addEventListener('click', () => this.stop());
    this.killButton.addEventListener('click', () => this.killAll());

    const master = el<HTMLInputElement>('master');
    master.addEventListener('input', () => this.setMasterVolume(Number(master.value), false));
  }

  private setMasterVolume(value: number, reflect: boolean): void {
    this.masterVolume = Math.min(1, Math.max(0, value));
    this.engine?.setMasterVolume(this.masterVolume);
    el<HTMLOutputElement>('master-readout').textContent = formatValue(this.masterVolume);
    if (reflect) el<HTMLInputElement>('master').value = String(this.masterVolume);
    this.queueAutosave();
  }

  private wireView(): void {
    const intensity = el<HTMLInputElement>('intensity');
    intensity.addEventListener('input', () => {
      this.visualIntensity = Number(intensity.value);
      this.visualizer.setIntensity(this.visualIntensity);
      el<HTMLOutputElement>('intensity-readout').textContent = formatValue(this.visualIntensity);
      this.queueAutosave();
    });

    const reduced = el<HTMLInputElement>('reduced-motion');
    reduced.addEventListener('change', () => {
      this.reducedMotion = reduced.checked;
      this.visualizer.setReducedMotion(this.reducedMotion);
      this.queueAutosave();
    });

    const performance = el<HTMLInputElement>('performance-mode');
    performance.addEventListener('change', () => {
      this.performanceMode = performance.checked;
      this.renderKeyHints();
    });
  }

  private renderKeyHints(): void {
    const hints = this.map.controls
      .filter((control) => control.keyboard && controlStatus(control.id).state === 'active')
      .map((control) => {
        const key = control.keyboard?.key === ' ' ? 'SPACE' : control.keyboard?.key.toUpperCase();
        return `${key} ${control.label}`;
      })
      .join('   ·   ');
    el<HTMLParagraphElement>('key-hints').textContent = this.performanceMode
      ? `live: ${hints}   ·   hold Shift to step a continuous control down`
      : `off: ${hints}`;
  }

  private wireKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      if (!this.performanceMode || event.metaKey || event.ctrlKey || event.altKey) return;
      if (this.isTyping(event.target)) return;
      const control = resolveKeyBinding(this.map, event.key);
      if (!control) return;
      if (control.kind === 'momentary' && this.heldKeys.has(control.id)) {
        event.preventDefault();
        return;
      }
      const next = this.surface.stepFromKeyboard(control, event.shiftKey);
      if (next === null) return;
      event.preventDefault();
      if (control.kind === 'momentary') this.heldKeys.add(control.id);
      this.surface.emitKeyboard(control, next);
    });

    window.addEventListener('keyup', (event) => {
      if (!this.performanceMode) return;
      const control = resolveKeyBinding(this.map, event.key);
      if (!control || control.kind !== 'momentary') return;
      this.heldKeys.delete(control.id);
      this.surface.emitKeyboard(control, 0);
    });

    window.addEventListener('blur', () => this.heldKeys.clear());
  }

  private isTyping(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT';
  }

  // ---------------------------------------------------------------- examples & project

  private buildExamples(): void {
    const container = el<HTMLDivElement>('examples');
    clear(container);
    EXAMPLES.forEach((example) => {
      const button = make('button', {
        className: 'btn btn--small btn--ghost',
        text: example.title,
        attrs: { type: 'button', title: example.blurb },
      });
      button.addEventListener('click', () => {
        if (!this.confirmReplace(`Load "${example.title}"? Your current pattern will be replaced.`)) return;
        this.titleInput.value = example.title;
        this.setEditorValue(example.source);
      });
      container.appendChild(button);
    });
  }

  private wireProject(): void {
    el<HTMLButtonElement>('save').addEventListener('click', () => this.save());
    el<HTMLButtonElement>('export').addEventListener('click', () => this.exportProject());
    this.titleInput.addEventListener('input', () => this.queueAutosave());

    const fileInput = el<HTMLInputElement>('import-file');
    el<HTMLButtonElement>('import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) void this.importFile(file);
    });

    el<HTMLButtonElement>('reset').addEventListener('click', () => {
      const example = defaultExample();
      if (!this.confirmReplace('Reset to the built-in example? Your current pattern will be replaced.')) return;
      this.titleInput.value = example.title;
      this.setEditorValue(example.source);
      this.projectMessage.textContent = `Reset to "${example.title}".`;
    });
  }

  private snapshot(): ProjectFile {
    return createProject({
      title: this.titleInput.value.trim() || 'Untitled',
      pattern: this.editor.value,
      controls: { ...this.controlState },
      master: this.masterVolume,
      visualIntensity: this.visualIntensity,
      reducedMotion: this.reducedMotion,
    });
  }

  private signature(): string {
    const project = this.snapshot();
    return JSON.stringify({
      title: project.title,
      pattern: project.pattern,
      controls: project.controls,
      master: project.master,
      visualIntensity: project.visualIntensity,
      reducedMotion: project.reducedMotion,
    });
  }

  private dirty(): boolean {
    return this.signature() !== this.savedSignature;
  }

  private queueAutosave(): void {
    if (!this.store.available) return;
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.save(), AUTOSAVE_DEBOUNCE_MS);
    if (this.dirty()) {
      this.saveTag.textContent = 'unsaved changes';
      this.saveTag.className = 'tag tag--pending';
    }
  }

  private save(): void {
    const project = this.snapshot();
    const outcome = this.store.save(project);
    if (outcome.ok) {
      this.savedSignature = this.signature();
      this.lastSavedAt = outcome.at;
      this.saveTag.textContent = `saved ${outcome.at.toLocaleTimeString()}`;
      this.saveTag.className = 'tag tag--live';
    } else {
      this.saveTag.textContent = 'save failed';
      this.saveTag.className = 'tag tag--bad';
      this.projectMessage.textContent = outcome.reason;
    }
  }

  private exportProject(): void {
    const project = this.snapshot();
    const blob = new Blob([serializeProject(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pattern';
    anchor.href = url;
    anchor.download = `${slug}.appliance.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.projectMessage.textContent = `Exported ${anchor.download}.`;
  }

  private async importFile(file: File): Promise<void> {
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      this.projectMessage.textContent = `Could not read that file: ${(error as Error).message}`;
      return;
    }
    const result = importProject(text);
    if (!result.ok) {
      this.projectMessage.textContent = `Import refused. ${result.errors.join(' ')}`;
      return;
    }
    if (!this.confirmReplace(`Replace the current project with "${result.project.title}"?`)) return;

    const project = result.project;
    this.titleInput.value = project.title;
    this.masterVolume = project.master;
    this.setMasterVolume(project.master, true);
    this.visualIntensity = project.visualIntensity;
    el<HTMLInputElement>('intensity').value = String(project.visualIntensity);
    el<HTMLOutputElement>('intensity-readout').textContent = formatValue(project.visualIntensity);
    this.visualizer.setIntensity(project.visualIntensity);
    this.reducedMotion = project.reducedMotion;
    el<HTMLInputElement>('reduced-motion').checked = project.reducedMotion;
    this.visualizer.setReducedMotion(project.reducedMotion);

    Object.entries(project.controls).forEach(([id, value]) => {
      if (!(id in this.controlState)) return;
      this.controlState[id] = value;
      this.surface.reflect(id, value);
    });
    this.pushAllControlsToEngine();
    this.visualizer.setMemory(this.controlState['memory'] ?? 0.25);

    this.setEditorValue(project.pattern);

    const parts = [`Imported "${project.title}".`];
    if (result.warnings.length) parts.push(`Repaired: ${result.warnings.join(' ')}`);
    if (result.patternIssues.length) {
      parts.push(
        `The pattern in that file has ${result.patternIssues.length} error(s); it is loaded in the editor but will not play until they are fixed.`,
      );
    }
    this.projectMessage.textContent = parts.join(' ');
  }

  private confirmReplace(question: string): boolean {
    if (!this.dirty()) return true;
    return window.confirm(`${question}\n\nThere are unsaved changes.`);
  }

  // ---------------------------------------------------------------- proposals

  private wireProposals(): void {
    el<HTMLButtonElement>('propose').addEventListener('click', () => void this.propose());
    this.auditionButton.addEventListener('click', () => this.toggleAudition());
    el<HTMLButtonElement>('accept').addEventListener('click', () => this.acceptProposal());
    el<HTMLButtonElement>('discard').addEventListener('click', () => this.discardProposal());
    this.revertButton.addEventListener('click', () => this.revert());
  }

  private async propose(): Promise<void> {
    this.proposalSeed += 1;
    const outcome = await variationProvider.propose({
      pattern: this.editor.value,
      seed: this.proposalSeed,
    });
    if (!outcome.ok) {
      this.proposalTag.textContent = 'no proposal';
      this.proposalTag.className = 'tag tag--bad';
      this.projectMessage.textContent = outcome.reason;
      return;
    }

    // Belt and braces: the host validates every proposal itself, whatever the provider claims.
    const parsed = parsePattern(outcome.proposal.pattern);
    if (!parsed.ok) {
      this.proposalTag.textContent = 'rejected';
      this.proposalTag.className = 'tag tag--bad';
      this.projectMessage.textContent =
        'A proposal arrived that does not parse. It was rejected and nothing changed.';
      return;
    }

    this.proposal = outcome.proposal;
    this.proposalPanel.hidden = false;
    this.proposalTag.textContent = 'proposal ready';
    this.proposalTag.className = 'tag tag--pending';
    el<HTMLHeadingElement>('proposal-label').textContent = outcome.proposal.label;
    const notes = el<HTMLUListElement>('proposal-notes');
    clear(notes);
    outcome.proposal.notes.forEach((note) => notes.appendChild(make('li', { text: note })));
    el<HTMLPreElement>('proposal-preview').textContent = outcome.proposal.pattern;
    this.updateAuditionButton();
  }

  private toggleAudition(): void {
    if (!this.proposal) return;
    if (this.auditioning) {
      this.auditioning = false;
      const mine = parsePattern(this.editor.value);
      if (mine.ok) this.sequencer.setScore(mine.score);
      this.setPatternState(this.sequencer.isRunning ? 'queued' : 'idle');
      this.updateAuditionButton();
      return;
    }
    const parsed = parsePattern(this.proposal.pattern);
    if (!parsed.ok) return;
    this.auditioning = true;
    this.sequencer.setScore(parsed.score);
    this.setPatternState('auditioning');
    this.updateAuditionButton();
  }

  private updateAuditionButton(): void {
    this.auditionButton.textContent = this.auditioning ? 'Stop audition' : 'Audition';
    this.auditionButton.setAttribute('aria-pressed', this.auditioning ? 'true' : 'false');
  }

  private acceptProposal(): void {
    const proposal = this.proposal;
    if (!proposal) return;
    if (!window.confirm('Accept this proposal? It replaces the pattern in the editor. You can revert afterwards.')) {
      return;
    }
    this.patternBeforeProposal = this.editor.value;
    this.auditioning = false;
    this.updateAuditionButton();
    this.setEditorValue(proposal.pattern);
    this.proposal = null;
    this.proposalPanel.hidden = true;
    this.proposalTag.textContent = 'accepted';
    this.proposalTag.className = 'tag tag--live';
    this.revertButton.hidden = false;
  }

  private discardProposal(): void {
    if (this.auditioning) this.toggleAudition();
    this.proposal = null;
    this.proposalPanel.hidden = true;
    this.proposalTag.textContent = 'no proposal';
    this.proposalTag.className = 'tag tag--quiet';
  }

  private revert(): void {
    const previous = this.patternBeforeProposal;
    if (previous === null) return;
    this.patternBeforeProposal = null;
    this.revertButton.hidden = true;
    this.setEditorValue(previous);
    this.proposalTag.textContent = 'reverted';
    this.proposalTag.className = 'tag tag--quiet';
  }

  /** Exposed for the browser smoke test. */
  debugState(): Record<string, unknown> {
    return {
      patternState: this.patternState,
      running: this.sequencer.isRunning,
      generation: this.sequencer.activeGeneration,
      pending: this.sequencer.hasPending,
      auditioning: this.auditioning,
      activeNotes: this.engine?.activeNoteCount() ?? 0,
      contextState: this.context?.state ?? 'none',
      savedAt: this.lastSavedAt?.toISOString() ?? null,
      dirty: this.dirty(),
    };
  }
}
