/**
 * The pattern language parser.
 *
 * Strictly a reader of text into `Score` data. It never evaluates anything, never touches the
 * DOM and never constructs a function, so a pattern pasted from anywhere is inert until the
 * sequencer reads the resulting data.
 *
 * Shape of the language (see docs/pattern-language.md for the player-facing guide):
 *
 *   tempo 68
 *   bars 4
 *   grid 8
 *
 *   voice pad tone
 *     wave triangle
 *     level 0.7
 *     play a3 . . _ | c4 . . . | . e4 . . | . . . .
 */

import {
  LIMITS,
  PERC_HITS,
  VOICE_KINDS,
  WAVEFORMS,
  type NoteEvent,
  type ParseResult,
  type PatternIssue,
  type PercHit,
  type Score,
  type Voice,
  type VoiceKind,
  type Waveform,
} from './types';

interface Token {
  text: string;
  /** 1-based column of the first character. */
  column: number;
}

interface VoiceDraft {
  voice: Voice;
  headerLine: number;
  /** One entry per written bar; each entry is the step slots of that bar. */
  bars: BarDraft[];
  sawPlay: boolean;
  seenProps: Set<string>;
}

interface BarDraft {
  slots: SlotDraft[];
  line: number;
  column: number;
  length: number;
}

interface SlotDraft {
  kind: 'rest' | 'tie' | 'sound';
  pitches: number[];
  hit?: PercHit;
  velocity: number;
  line: number;
}

const NOTE_PATTERN = /^([a-g])([#b]?)(-1|[0-9])$/;
const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/i;
const SEMITONES: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

const DEFAULT_LEVEL: Record<VoiceKind, number> = { tone: 0.75, bass: 0.8, perc: 0.7 };
const DEFAULT_WAVE: Record<VoiceKind, Waveform> = { tone: 'triangle', bass: 'sine', perc: 'sine' };

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < line.length) {
    while (index < line.length && /\s/.test(line[index] as string)) index += 1;
    if (index >= line.length) break;
    const start = index;
    if (line[index] === '[') {
      while (index < line.length && line[index] !== ']') index += 1;
      if (index < line.length) index += 1;
      // Velocity suffix rides along with the chord: [c4 e4]@0.6
      while (index < line.length && !/\s/.test(line[index] as string)) index += 1;
    } else {
      while (index < line.length && !/\s/.test(line[index] as string)) index += 1;
    }
    tokens.push({ text: line.slice(start, index), column: start + 1 });
  }
  return tokens;
}

function stripComment(line: string): string {
  const hash = line.indexOf('#');
  if (hash === -1) return line;
  // A '#' inside a note token (f#4) is never at the start of a token, so only treat it as a
  // comment when it opens one.
  let index = 0;
  while (index < line.length) {
    if (line[index] === '#' && (index === 0 || /\s/.test(line[index - 1] as string))) {
      return line.slice(0, index);
    }
    index += 1;
  }
  return line;
}

function parseNumber(text: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function noteToMidi(text: string): number | null {
  const match = NOTE_PATTERN.exec(text);
  if (!match) return null;
  const [, letter, accidental, octaveText] = match as unknown as [string, string, string, string];
  const base = SEMITONES[letter];
  if (base === undefined) return null;
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  const octave = Number(octaveText);
  return (octave + 1) * 12 + base + shift;
}

export function parsePattern(source: string): ParseResult {
  const errors: PatternIssue[] = [];
  const warnings: PatternIssue[] = [];
  const lines = source.split(/\r?\n/);

  let tempo: number | null = null;
  let bars: number | null = null;
  let grid: number | null = null;
  // Tracked separately so a header that is present but wrong reports one clear error rather
  // than also claiming it is missing.
  const seenDirectives = new Set<string>();
  let sawVoiceHeader = false;
  const drafts: VoiceDraft[] = [];
  const seenNames = new Set<string>();
  let current: VoiceDraft | null = null;

  const fail = (line: number, token: Token | null, message: string, hint?: string): void => {
    errors.push({
      line,
      column: token ? token.column : 1,
      length: token ? token.text.length : Math.max(1, (lines[line - 1] ?? '').length),
      message,
      ...(hint ? { hint } : {}),
    });
  };

  const readScalar = (
    lineNumber: number,
    tokens: Token[],
    label: string,
    min: number,
    max: number,
    integer: boolean,
  ): number | null => {
    if (tokens.length !== 2) {
      fail(lineNumber, tokens[0] ?? null, `${label} needs exactly one value.`, `Example: ${label} ${min}`);
      return null;
    }
    const token = tokens[1] as Token;
    const value = parseNumber(token.text);
    if (value === null) {
      fail(lineNumber, token, `${label} expects a number, found "${token.text}".`);
      return null;
    }
    if (integer && !Number.isInteger(value)) {
      fail(lineNumber, token, `${label} must be a whole number.`);
      return null;
    }
    if (value < min || value > max) {
      fail(lineNumber, token, `${label} must be between ${min} and ${max}.`);
      return null;
    }
    return value;
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = stripComment(rawLine);
    if (!line.trim()) return;

    const tokens = tokenizeLine(line);
    const head = tokens[0] as Token;
    const keyword = head.text.toLowerCase();

    switch (keyword) {
      case 'tempo': {
        if (seenDirectives.has('tempo')) fail(lineNumber, head, 'tempo is set more than once.');
        seenDirectives.add('tempo');
        const value = readScalar(lineNumber, tokens, 'tempo', LIMITS.tempoMin, LIMITS.tempoMax, false);
        if (value !== null) tempo = value;
        return;
      }
      case 'bars': {
        if (seenDirectives.has('bars')) fail(lineNumber, head, 'bars is set more than once.');
        seenDirectives.add('bars');
        const value = readScalar(lineNumber, tokens, 'bars', LIMITS.barsMin, LIMITS.barsMax, true);
        if (value !== null) bars = value;
        return;
      }
      case 'grid': {
        if (seenDirectives.has('grid')) fail(lineNumber, head, 'grid is set more than once.');
        seenDirectives.add('grid');
        const value = readScalar(lineNumber, tokens, 'grid', LIMITS.gridMin, LIMITS.gridMax, true);
        if (value !== null) grid = value;
        return;
      }
      case 'voice': {
        sawVoiceHeader = true;
        current = startVoice(lineNumber, tokens, drafts, seenNames, fail);
        return;
      }
      case 'wave':
      case 'level':
      case 'octave':
      case 'mute':
      case 'play': {
        if (!current) {
          fail(lineNumber, head, `"${keyword}" belongs inside a voice.`, 'Add a "voice <name> <kind>" line above it.');
          return;
        }
        applyVoiceLine(lineNumber, keyword, tokens, current, fail);
        return;
      }
      default:
        fail(
          lineNumber,
          head,
          `Unknown instruction "${head.text}".`,
          'Expected tempo, bars, grid, voice, wave, level, octave, mute or play.',
        );
    }
  });

  if (tempo === null && !seenDirectives.has('tempo')) {
    errors.push({ line: 1, column: 1, length: 1, message: 'Missing "tempo".', hint: 'Example: tempo 96' });
  }
  if (bars === null && !seenDirectives.has('bars')) {
    errors.push({ line: 1, column: 1, length: 1, message: 'Missing "bars".', hint: 'Example: bars 4' });
  }
  if (grid === null && !seenDirectives.has('grid')) {
    errors.push({ line: 1, column: 1, length: 1, message: 'Missing "grid".', hint: 'Example: grid 8 (eighth notes)' });
  }
  if (!drafts.length && !sawVoiceHeader) {
    errors.push({ line: 1, column: 1, length: 1, message: 'No voices. The pattern would be silent.', hint: 'Example: voice lead tone' });
  }
  if (drafts.length > LIMITS.voicesMax) {
    const extra = drafts[LIMITS.voicesMax] as VoiceDraft;
    errors.push({ line: extra.headerLine, column: 1, length: 5, message: `At most ${LIMITS.voicesMax} voices.` });
  }

  drafts.forEach((draft) => {
    if (!draft.sawPlay) {
      errors.push({
        line: draft.headerLine,
        column: 1,
        length: 5,
        message: `Voice "${draft.voice.name}" has no "play" line.`,
        hint: 'Example: play c4 . e4 .',
      });
    }
  });

  if (errors.length || tempo === null || bars === null || grid === null) {
    return { ok: false, errors: sortIssues(errors), warnings };
  }

  const score = buildScore(source, tempo, bars, grid, drafts, errors, warnings);
  if (errors.length || !score) return { ok: false, errors: sortIssues(errors), warnings };
  return { ok: true, score, warnings };
}

type Fail = (line: number, token: Token | null, message: string, hint?: string) => void;

function startVoice(
  lineNumber: number,
  tokens: Token[],
  drafts: VoiceDraft[],
  seenNames: Set<string>,
  fail: Fail,
): VoiceDraft | null {
  if (tokens.length !== 3) {
    fail(lineNumber, tokens[0] as Token, 'A voice line needs a name and a kind.', 'Example: voice lead tone');
    return null;
  }
  const nameToken = tokens[1] as Token;
  const kindToken = tokens[2] as Token;
  if (!NAME_PATTERN.test(nameToken.text)) {
    fail(lineNumber, nameToken, `"${nameToken.text}" is not a usable voice name.`, 'Letters, digits, - and _ only.');
    return null;
  }
  const name = nameToken.text.toLowerCase();
  if (seenNames.has(name)) {
    fail(lineNumber, nameToken, `Voice "${name}" is declared twice.`);
    return null;
  }
  const kind = kindToken.text.toLowerCase() as VoiceKind;
  if (!VOICE_KINDS.includes(kind)) {
    fail(lineNumber, kindToken, `Unknown voice kind "${kindToken.text}".`, `Use one of: ${VOICE_KINDS.join(', ')}.`);
    return null;
  }
  seenNames.add(name);
  const draft: VoiceDraft = {
    voice: {
      name,
      kind,
      wave: DEFAULT_WAVE[kind],
      level: DEFAULT_LEVEL[kind],
      muted: false,
      octave: 0,
      writtenBars: 0,
    },
    headerLine: lineNumber,
    bars: [],
    sawPlay: false,
    seenProps: new Set<string>(),
  };
  drafts.push(draft);
  return draft;
}

function applyVoiceLine(lineNumber: number, keyword: string, tokens: Token[], draft: VoiceDraft, fail: Fail): void {
  const head = tokens[0] as Token;
  if (keyword !== 'play' && draft.seenProps.has(keyword)) {
    fail(lineNumber, head, `"${keyword}" is set twice on voice "${draft.voice.name}".`);
    return;
  }
  if (keyword !== 'play') draft.seenProps.add(keyword);

  switch (keyword) {
    case 'wave': {
      if (draft.voice.kind === 'perc') {
        fail(lineNumber, head, 'Percussion voices synthesize their own sounds.', 'Remove the wave line from this voice.');
        return;
      }
      const token = tokens[1];
      if (tokens.length !== 2 || !token) {
        fail(lineNumber, head, 'wave needs one value.', `One of: ${WAVEFORMS.join(', ')}.`);
        return;
      }
      const wave = token.text.toLowerCase() as Waveform;
      if (!WAVEFORMS.includes(wave)) {
        fail(lineNumber, token, `Unknown wave "${token.text}".`, `One of: ${WAVEFORMS.join(', ')}.`);
        return;
      }
      draft.voice.wave = wave;
      return;
    }
    case 'level': {
      const token = tokens[1];
      if (tokens.length !== 2 || !token) {
        fail(lineNumber, head, 'level needs one value between 0 and 1.');
        return;
      }
      const value = parseNumber(token.text);
      if (value === null || value < 0 || value > 1) {
        fail(lineNumber, token, 'level must be a number between 0 and 1.');
        return;
      }
      draft.voice.level = value;
      return;
    }
    case 'octave': {
      const token = tokens[1];
      if (tokens.length !== 2 || !token) {
        fail(lineNumber, head, 'octave needs one whole number.');
        return;
      }
      const value = parseNumber(token.text);
      if (value === null || !Number.isInteger(value) || Math.abs(value) > LIMITS.octaveShiftMax) {
        fail(lineNumber, token, `octave must be a whole number from -${LIMITS.octaveShiftMax} to ${LIMITS.octaveShiftMax}.`);
        return;
      }
      draft.voice.octave = value;
      return;
    }
    case 'mute': {
      if (tokens.length !== 1) {
        fail(lineNumber, tokens[1] as Token, 'mute takes no value.');
        return;
      }
      draft.voice.muted = true;
      return;
    }
    case 'play': {
      draft.sawPlay = true;
      readPlayLine(lineNumber, tokens.slice(1), draft, fail);
      return;
    }
    default:
      fail(lineNumber, head, `Unknown voice setting "${head.text}".`);
  }
}

function readPlayLine(lineNumber: number, tokens: Token[], draft: VoiceDraft, fail: Fail): void {
  if (!tokens.length) {
    fail(lineNumber, null, 'play needs at least one step.', 'Example: play c4 . e4 _');
    return;
  }

  // Bars are separated by "|" and always close at the end of the line, so a voice can be
  // written across several play lines without the bars bleeding into each other.
  let bar: BarDraft | null = null;

  for (const token of tokens) {
    if (token.text === '|') {
      bar = null;
      continue;
    }
    if (bar === null) {
      bar = { slots: [], line: lineNumber, column: token.column, length: 1 };
      draft.bars.push(bar);
    }
    const slot = readSlot(lineNumber, token, draft, fail);
    if (slot) bar.slots.push(slot);
    bar.length = Math.max(bar.length, token.column + token.text.length - bar.column);
  }
}

function readSlot(lineNumber: number, token: Token, draft: VoiceDraft, fail: Fail): SlotDraft | null {
  const text = token.text;
  if (text === '.') return { kind: 'rest', pitches: [], velocity: 0, line: lineNumber };
  if (text === '_') return { kind: 'tie', pitches: [], velocity: 0, line: lineNumber };

  const { body, velocity, ok } = splitVelocity(text);
  if (!ok) {
    fail(lineNumber, token, `"${text}" has an unreadable velocity.`, 'Velocity is @0 to @1, for example c4@0.6.');
    return null;
  }

  if (draft.voice.kind === 'perc') {
    const hit = body.toLowerCase() as PercHit;
    if (!PERC_HITS.includes(hit)) {
      fail(lineNumber, token, `"${body}" is not a percussion sound.`, `Use one of: ${PERC_HITS.join(', ')}, "." or "_".`);
      return null;
    }
    return { kind: 'sound', pitches: [], hit, velocity, line: lineNumber };
  }

  const names = body.startsWith('[')
    ? body.replace(/^\[/, '').replace(/\]$/, '').trim().split(/[\s,]+/).filter(Boolean)
    : [body];

  if (body.startsWith('[') && !body.endsWith(']')) {
    fail(lineNumber, token, 'A chord must close with "]".', 'Example: [c4 e4 g4]');
    return null;
  }
  if (!names.length) {
    fail(lineNumber, token, 'Empty chord.', 'Example: [c4 e4 g4]');
    return null;
  }
  if (names.length > LIMITS.chordMax) {
    fail(lineNumber, token, `A chord may hold at most ${LIMITS.chordMax} notes.`);
    return null;
  }

  const pitches: number[] = [];
  for (const name of names) {
    if (PERC_HITS.includes(name.toLowerCase() as PercHit)) {
      fail(lineNumber, token, `"${name}" is a percussion sound, but "${draft.voice.name}" is a ${draft.voice.kind} voice.`);
      return null;
    }
    const midi = noteToMidi(name.toLowerCase());
    if (midi === null) {
      fail(lineNumber, token, `"${name}" is not a note.`, 'Notes look like c4, f#2 or bb3. Use "." for a rest.');
      return null;
    }
    const shifted = midi + draft.voice.octave * 12;
    if (shifted < LIMITS.midiMin || shifted > LIMITS.midiMax) {
      fail(lineNumber, token, `"${name}" lands outside the playable range after the octave shift.`);
      return null;
    }
    pitches.push(shifted);
  }

  return { kind: 'sound', pitches, velocity, line: lineNumber };
}

function splitVelocity(text: string): { body: string; velocity: number; ok: boolean } {
  const at = text.lastIndexOf('@');
  if (at === -1) return { body: text, velocity: 0.85, ok: true };
  const body = text.slice(0, at);
  const value = parseNumber(text.slice(at + 1));
  if (!body || value === null || value < 0 || value > 1) return { body, velocity: 0.85, ok: false };
  return { body, velocity: value, ok: true };
}

function buildScore(
  source: string,
  tempo: number,
  bars: number,
  grid: number,
  drafts: VoiceDraft[],
  errors: PatternIssue[],
  warnings: PatternIssue[],
): Score | null {
  const voices: Voice[] = [];
  const events: NoteEvent[] = [];

  drafts.forEach((draft, voiceIndex) => {
    const written = draft.bars.filter((bar) => bar.slots.length > 0);
    if (!written.length) return;

    written.forEach((bar, barIndex) => {
      if (bar.slots.length !== grid) {
        errors.push({
          line: bar.line,
          column: bar.column,
          length: bar.length,
          message: `Voice "${draft.voice.name}" bar ${barIndex + 1} has ${bar.slots.length} step${
            bar.slots.length === 1 ? '' : 's'
          }, but grid is ${grid}.`,
          hint: 'Every bar between "|" markers needs exactly "grid" steps.',
        });
      }
    });

    if (bars % written.length !== 0) {
      errors.push({
        line: draft.headerLine,
        column: 1,
        length: 5,
        message: `Voice "${draft.voice.name}" writes ${written.length} bars, which does not divide the ${bars}-bar loop.`,
        hint: `Write ${bars} bars, or a number that divides into ${bars}.`,
      });
      return;
    }

    if (written.length < bars) {
      warnings.push({
        line: draft.headerLine,
        column: 1,
        length: 5,
        message: `Voice "${draft.voice.name}" repeats its ${written.length}-bar phrase across the ${bars}-bar loop.`,
      });
    }

    draft.voice.writtenBars = written.length;
    voices.push(draft.voice);

    const repeats = bars / written.length;
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      for (let barIndex = 0; barIndex < written.length; barIndex += 1) {
        const bar = written[barIndex] as BarDraft;
        const barOffset = (repeat * written.length + barIndex) * grid;
        let open: NoteEvent | null = null;
        for (let slotIndex = 0; slotIndex < bar.slots.length; slotIndex += 1) {
          const slot = bar.slots[slotIndex] as SlotDraft;
          if (slot.kind === 'rest') {
            open = null;
            continue;
          }
          if (slot.kind === 'tie') {
            if (open) open.steps += 1;
            else if (repeat === 0) {
              warnings.push({
                line: slot.line,
                column: 1,
                length: 1,
                message: `A "_" in voice "${draft.voice.name}" has nothing to hold, so it reads as a rest.`,
              });
            }
            continue;
          }
          const event: NoteEvent = {
            voice: voiceIndex,
            step: barOffset + slotIndex,
            steps: 1,
            pitches: slot.pitches,
            velocity: slot.velocity,
            line: slot.line,
            ...(slot.hit ? { hit: slot.hit } : {}),
          };
          events.push(event);
          // Percussion hits decay on their own; holding them across steps means nothing.
          open = draft.voice.kind === 'perc' ? null : event;
        }
      }
    }
  });

  if (errors.length) return null;
  if (!voices.length) {
    errors.push({ line: 1, column: 1, length: 1, message: 'No playable voices survived parsing.' });
    return null;
  }
  if (events.length > LIMITS.eventsMax) {
    errors.push({
      line: 1,
      column: 1,
      length: 1,
      message: `This loop holds ${events.length} notes, above the ${LIMITS.eventsMax} note ceiling.`,
      hint: 'Shorten the loop, coarsen the grid or remove a voice.',
    });
    return null;
  }

  // Voice indices were assigned from the draft list; re-map them onto the surviving voices.
  const remap = new Map<number, number>();
  drafts.forEach((draft, draftIndex) => {
    const position = voices.indexOf(draft.voice);
    if (position !== -1) remap.set(draftIndex, position);
  });
  events.forEach((event) => {
    event.voice = remap.get(event.voice) ?? 0;
  });

  events.sort((a, b) => a.step - b.step || a.voice - b.voice);

  return { tempo, bars, grid, voices, events, totalSteps: bars * grid, source };
}

function sortIssues(issues: PatternIssue[]): PatternIssue[] {
  return [...issues].sort((a, b) => a.line - b.line || a.column - b.column);
}

export function formatIssue(issue: PatternIssue): string {
  return `line ${issue.line}, column ${issue.column}: ${issue.message}${issue.hint ? ` ${issue.hint}` : ''}`;
}
