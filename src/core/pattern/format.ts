/**
 * Score back to pattern text.
 *
 * Used by the variation tool, which must hand back something a human can read and edit rather
 * than an opaque blob. Printing is lossy in exactly one harmless way: an `octave` shift has
 * already been folded into the pitches at parse time, so the printed text states the resulting
 * notes and omits the shift. Re-parsing the printed text yields the same music.
 */

import type { NoteEvent, Score, Voice } from './types';

const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const DEFAULT_VELOCITY = 0.85;

export function midiToName(midi: number): string {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12] as string;
  return `${name}${octave}`;
}

function velocitySuffix(velocity: number): string {
  if (Math.abs(velocity - DEFAULT_VELOCITY) < 1e-6) return '';
  return `@${Number(velocity.toFixed(2))}`;
}

function slotToken(event: NoteEvent): string {
  if (event.hit) return `${event.hit}${velocitySuffix(event.velocity)}`;
  if (event.pitches.length === 1) return `${midiToName(event.pitches[0] as number)}${velocitySuffix(event.velocity)}`;
  const names = event.pitches.map((pitch) => midiToName(pitch)).join(' ');
  return `[${names}]${velocitySuffix(event.velocity)}`;
}

function voiceSlots(score: Score, voiceIndex: number): string[] {
  const slots = new Array<string>(score.totalSteps).fill('.');
  score.events
    .filter((event) => event.voice === voiceIndex)
    .forEach((event) => {
      slots[event.step] = slotToken(event);
      for (let offset = 1; offset < event.steps; offset += 1) {
        const step = event.step + offset;
        if (step < slots.length) slots[step] = '_';
      }
    });
  return slots;
}

function padColumns(bars: string[][]): string[][] {
  const width = new Map<number, number>();
  bars.forEach((bar) => {
    bar.forEach((token, index) => {
      width.set(index, Math.max(width.get(index) ?? 0, token.length));
    });
  });
  return bars.map((bar) => bar.map((token, index) => token.padEnd(width.get(index) ?? token.length)));
}

function formatVoice(score: Score, voice: Voice, voiceIndex: number): string {
  const slots = voiceSlots(score, voiceIndex);
  const bars: string[][] = [];
  for (let bar = 0; bar < score.bars; bar += 1) {
    bars.push(slots.slice(bar * score.grid, (bar + 1) * score.grid));
  }
  const lines = [`voice ${voice.name} ${voice.kind}`];
  if (voice.kind !== 'perc') lines.push(`  wave ${voice.wave}`);
  lines.push(`  level ${Number(voice.level.toFixed(2))}`);
  if (voice.muted) lines.push('  mute');
  padColumns(bars).forEach((bar) => {
    lines.push(`  play ${bar.join(' ').trimEnd()}`);
  });
  return lines.join('\n');
}

export function formatScore(score: Score, header?: string): string {
  const head = [
    ...(header ? header.split('\n').map((line) => (line.startsWith('#') ? line : `# ${line}`)) : []),
    `tempo ${Number(score.tempo.toFixed(2))}`,
    `bars ${score.bars}`,
    `grid ${score.grid}`,
  ];
  const voices = score.voices.map((voice, index) => formatVoice(score, voice, index));
  return `${head.join('\n')}\n\n${voices.join('\n\n')}\n`;
}
