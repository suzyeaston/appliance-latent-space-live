import type { Score } from '../pattern/types';

export type VisualDialect = 'house' | 'broken' | 'dub' | 'ambient' | 'electro' | 'free';

export type MusicalMetrics = {
  tempo: number;
  density: number;
  sustain: number;
  syncopation: number;
  percussion: number;
  fourFloor: number;
  swing: number;
};

export type MusicalVisualIdentity = MusicalMetrics & {
  dialect: VisualDialect;
  label: string;
  geometry: 'clock' | 'fracture' | 'echo' | 'nebula' | 'circuit' | 'hybrid';
  hueShift: number;
  echoLayers: number;
  angularWarp: number;
  radialSpread: number;
};

const DIALECTS: Record<VisualDialect, Omit<MusicalVisualIdentity, keyof MusicalMetrics | 'dialect'>> = {
  house:   { label: 'HOUSE',   geometry: 'clock',    hueShift: 24,  echoLayers: 1, angularWarp: 0.00, radialSpread: 0.78 },
  broken:  { label: 'BROKEN',  geometry: 'fracture', hueShift: 318, echoLayers: 1, angularWarp: 0.16, radialSpread: 0.92 },
  dub:     { label: 'DUB',     geometry: 'echo',     hueShift: 150, echoLayers: 4, angularWarp: 0.035,radialSpread: 0.68 },
  ambient: { label: 'AMBIENT', geometry: 'nebula',   hueShift: 205, echoLayers: 3, angularWarp: 0.018,radialSpread: 1.08 },
  electro: { label: 'ELECTRO', geometry: 'circuit',  hueShift: 292, echoLayers: 2, angularWarp: 0.075,radialSpread: 0.86 },
  free:    { label: 'FREE',    geometry: 'hybrid',   hueShift: 0,   echoLayers: 2, angularWarp: 0.05, radialSpread: 0.84 },
};

const clamp = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, value));

function explicitDialect(score: Score): VisualDialect | null {
  const match = score.source.match(/^\s*#\s*(house|broken|dub|ambient|electro)\b/im);
  return match ? match[1] as VisualDialect : null;
}

export function musicalMetrics(score: Score): MusicalMetrics {
  const activeVoices = new Set(score.voices.map((v, i) => v.muted ? -1 : i).filter(i => i >= 0));
  const events = score.events.filter(event => activeVoices.has(event.voice));
  const pitched = events.filter(event => event.pitches.length > 0);
  const percussion = events.filter(event => Boolean(event.hit));
  const stepsPerBeat = score.grid / 4;

  const density = clamp(events.length / Math.max(1, score.totalSteps * 0.75));
  const sustain = pitched.length
    ? clamp(pitched.reduce((sum, event) => sum + event.steps, 0) / pitched.length / Math.max(1, stepsPerBeat * 2))
    : 0;
  const syncopated = events.filter(event => {
    if (stepsPerBeat <= 0) return false;
    const beatPosition = event.step % stepsPerBeat;
    const distance = Math.min(beatPosition, Math.abs(stepsPerBeat - beatPosition));
    return distance > Math.max(0.15, stepsPerBeat * 0.18);
  }).length;
  const syncopation = events.length ? syncopated / events.length : 0;
  const percussionRatio = events.length ? percussion.length / events.length : 0;

  const kicks = percussion.filter(event => event.hit === 'kick');
  const kickOnBeat = kicks.filter(event => {
    if (stepsPerBeat <= 0) return false;
    const beatPosition = event.step % stepsPerBeat;
    return Math.min(beatPosition, Math.abs(stepsPerBeat - beatPosition)) < Math.max(0.12, stepsPerBeat * 0.1);
  }).length;
  const expectedKicks = Math.max(1, score.bars * 4);
  const fourFloor = clamp((kickOnBeat / expectedKicks) * 1.15);

  return {
    tempo: score.tempo,
    density,
    sustain,
    syncopation,
    percussion: percussionRatio,
    fourFloor,
    swing: clamp(score.swing ?? 0, 0, 0.45),
  };
}

export function detectVisualDialect(score: Score): VisualDialect {
  const explicit = explicitDialect(score);
  if (explicit) return explicit;

  const m = musicalMetrics(score);
  if (m.tempo <= 82 && m.sustain >= 0.42 && m.density <= 0.55) return 'ambient';
  if (m.tempo <= 96 && m.percussion >= 0.22 && m.fourFloor < 0.55) return 'dub';
  if (m.tempo >= 122 && (m.swing >= 0.13 || m.syncopation >= 0.42)) return 'broken';
  if (m.tempo >= 112 && m.tempo <= 132 && m.fourFloor >= 0.55) return 'house';
  if (m.tempo >= 100 && m.tempo <= 132 && (m.syncopation >= 0.25 || m.percussion >= 0.28)) return 'electro';
  return 'free';
}

export function musicalVisualIdentity(score: Score): MusicalVisualIdentity {
  const metrics = musicalMetrics(score);
  const dialect = detectVisualDialect(score);
  return { ...metrics, dialect, ...DIALECTS[dialect] };
}
