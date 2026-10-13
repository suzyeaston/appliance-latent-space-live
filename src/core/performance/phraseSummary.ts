import type { Score } from '../pattern/types';

const NAMES = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];

/** Describe explicit notes, without guessing a tonal centre from a relative scale. */
export function firstHarmony(score: Score): string {
  const audible = score.events.filter(e => e.pitches.length && e.velocity > 0 &&
    !score.voices[e.voice]?.muted && (score.voices[e.voice]?.level ?? 0) > 0);
  const chord = audible.find(e => new Set(e.pitches.map(p=>p%12)).size >= 3);
  if (!chord) {
    const note = audible[0]?.pitches[0];
    return note === undefined ? 'no pitched notes' : `opening note: ${NAMES[note%12]}`;
  }
  const notes = [...new Set(chord.pitches.map(p=>p%12))];
  for (const root of notes) {
    const intervals = notes.map(p=>(p-root+12)%12).sort((a,b)=>a-b).join(',');
    const quality = ({'0,4,7':'major','0,3,7':'minor','0,3,6':'diminished','0,4,8':'augmented'} as Record<string,string>)[intervals];
    if (quality) return `first chord: ${NAMES[root]} ${quality}`;
  }
  return 'first chord: custom voicing';
}

export function phraseSummary(score: Score): string {
  const heading = score.source.match(/^\s*#\s*([^\n]+)/)?.[1]?.slice(0,80);
  return `${heading || 'Custom / edited phrase'} · ${firstHarmony(score)}`;
}
