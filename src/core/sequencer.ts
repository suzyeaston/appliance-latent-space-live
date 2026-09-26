/**
 * Musical time.
 *
 * The sequencer owns the loop position and schedules notes ahead of the audio clock. It never
 * reads a frame timer, so visual stutter cannot move a note. Everything it needs from the
 * outside is a `now()` reading in audio-clock seconds, which makes it testable against a fake
 * clock with no browser at all.
 */

import { secondsPerStep, type NoteEvent, type Score } from './pattern/types';

export interface ScheduledNote {
  event: NoteEvent;
  /** Audio-clock time of the attack. */
  time: number;
  /** Length of the note in seconds, before the engine's own release tail. */
  duration: number;
  /** Position within the loop at the moment of the attack. */
  loopStep: number;
  bar: number;
  /** Which score generation produced it, so the UI can tell old notes from new. */
  generation: number;
}

export interface BarEvent {
  time: number;
  bar: number;
  bars: number;
  generation: number;
  /** True when this bar began with a swap to a newly applied pattern. */
  applied: boolean;
}

export interface SequencerOptions {
  now: () => number;
  onNotes: (notes: ScheduledNote[]) => void;
  onBar?: (bar: BarEvent) => void;
  /** Seconds of look-ahead. Bigger survives a busy main thread; smaller feels tighter. */
  lookahead?: number;
}

export interface SequencerPosition {
  running: boolean;
  bar: number;
  bars: number;
  step: number;
  grid: number;
  /** 0..1 through the whole loop. */
  loopPhase: number;
  generation: number;
}

const DEFAULT_LOOKAHEAD = 0.25;
/** Never schedule more than this many steps in one tick, whatever the clock says. */
const MAX_STEPS_PER_TICK = 256;

export class Sequencer {
  private readonly now: () => number;
  private readonly onNotes: (notes: ScheduledNote[]) => void;
  private readonly onBar: ((bar: BarEvent) => void) | undefined;
  private readonly lookahead: number;

  private score: Score;
  private pending: Score | null = null;
  private generation = 1;
  private pendingGeneration = 0;

  private running = false;
  private loopStep = 0;
  private nextStepTime = 0;
  private frozen = false;
  private appliedAtNextBar = false;

  constructor(score: Score, options: SequencerOptions) {
    this.score = score;
    this.now = options.now;
    this.onNotes = options.onNotes;
    this.onBar = options.onBar;
    this.lookahead = options.lookahead ?? DEFAULT_LOOKAHEAD;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get activeScore(): Score {
    return this.score;
  }

  get activeGeneration(): number {
    return this.generation;
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  /**
   * Queue a pattern. While stopped it takes effect immediately; while playing it waits for the
   * next bar line so an edit never chops a bar in half. The previous pattern keeps playing until
   * then, which is also what happens when an edit fails to parse: nothing is queued at all.
   */
  setScore(score: Score, options: { immediate?: boolean } = {}): 'applied' | 'queued' {
    if (!this.running || options.immediate) {
      this.score = score;
      this.generation += 1;
      this.pending = null;
      this.loopStep = Math.min(this.loopStep, score.totalSteps - 1);
      return 'applied';
    }
    this.pending = score;
    this.pendingGeneration = this.generation + 1;
    return 'queued';
  }

  clearPending(): void {
    this.pending = null;
  }

  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
  }

  start(startTime?: number): void {
    if (this.running) return;
    this.running = true;
    this.loopStep = 0;
    // A hair of lead time so the first note is scheduled, never played late.
    this.nextStepTime = (startTime ?? this.now()) + 0.06;
  }

  stop(): void {
    this.running = false;
    this.loopStep = 0;
    this.pending = null;
  }

  /** Restart the loop from bar one without dropping the audio graph. */
  retrigger(startTime?: number): void {
    this.loopStep = 0;
    this.nextStepTime = (startTime ?? this.now()) + 0.02;
    this.running = true;
  }

  /** Called on a plain interval. Schedules everything that starts inside the look-ahead window. */
  tick(): void {
    if (!this.running) return;
    const horizon = this.now() + this.lookahead;
    let guard = 0;
    while (this.nextStepTime < horizon && guard < MAX_STEPS_PER_TICK) {
      guard += 1;
      this.scheduleStep();
      this.advance();
    }
  }

  position(): SequencerPosition {
    const grid = this.score.grid;
    return {
      running: this.running,
      bar: Math.floor(this.loopStep / grid),
      bars: this.score.bars,
      step: this.loopStep % grid,
      grid,
      loopPhase: this.score.totalSteps ? this.loopStep / this.score.totalSteps : 0,
      generation: this.generation,
    };
  }

  private scheduleStep(): void {
    const grid = this.score.grid;
    const atBarLine = this.loopStep % grid === 0;

    if (atBarLine) {
      if (this.pending) this.applyPending();
      this.onBar?.({
        time: this.nextStepTime,
        bar: Math.floor(this.loopStep / this.score.grid),
        bars: this.score.bars,
        generation: this.generation,
        applied: this.appliedAtNextBar,
      });
      this.appliedAtNextBar = false;
    }

    const step = secondsPerStep(this.score.tempo, this.score.grid);
    const due = this.score.events.filter((event: NoteEvent) => event.step === this.loopStep);
    if (due.length) {
      this.onNotes(
        due.map((event) => ({
          event,
          time: this.nextStepTime,
          duration: event.steps * step,
          loopStep: this.loopStep,
          bar: Math.floor(this.loopStep / this.score.grid),
          generation: this.generation,
        })),
      );
    }
  }

  private applyPending(): void {
    const next = this.pending as Score;
    const currentBar = Math.floor(this.loopStep / this.score.grid);
    this.score = next;
    this.generation = this.pendingGeneration || this.generation + 1;
    this.pending = null;
    this.appliedAtNextBar = true;
    // Hold the player's place in the form when the new pattern is long enough to have one.
    const bar = next.bars > 0 ? currentBar % next.bars : 0;
    this.loopStep = bar * next.grid;
  }

  private advance(): void {
    const grid = this.score.grid;
    const stepSeconds = secondsPerStep(this.score.tempo, grid);
    this.nextStepTime += stepSeconds;

    const next = this.loopStep + 1;
    if (this.frozen && next % grid === 0) {
      // Freeze holds the bar the player is in; the loop stops advancing but time does not.
      this.loopStep = next - grid;
      return;
    }
    this.loopStep = next % this.score.totalSteps;
  }
}
