/** Local instance-based regression. No pretraining, network, or bundled training examples. */
import type { Score } from '../pattern/types';
export type Style = { hue: number; orbit: number; spread: number; motion: number; trails: number };
export type Example = { name: string; features: number[]; style: Style };
export type VisualLibrary = { version: 1; examples: Example[]; trained: Example[] };
export const DEFAULT_STYLE: Style = { hue: 265, orbit: 0.85, spread: 0.65, motion: 0.35, trails: 0.55 };
export const MAX_EXAMPLES = 128;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export function featuresFor(score: Score, controls: Record<string, number>): number[] {
  const events = score.events.filter(e => !score.voices[e.voice]?.muted);
  const pitches = events.flatMap(e => e.pitches);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  return [clamp((score.tempo - 20) / 280), clamp(events.length / score.totalSteps / 4),
    clamp((mean(pitches) - 12) / 96), mean(events.map(e => e.velocity * (score.voices[e.voice]?.level ?? 0))),
    clamp(mean(events.map(e => e.steps / score.grid))),
    events.filter(e => e.hit).length / Math.max(1, events.length),
    clamp(controls['browning'] ?? 0.35), clamp(controls['destruction'] ?? 0), clamp(controls['memory'] ?? 0.25)];
}
export function distance(a: number[], b: number[]): number {
  return a.reduce((sum, value, i) => sum + (value - (b[i] ?? 0)) ** 2, 0);
}
export function distinctCount(examples: Example[]): number {
  const unique: Example[] = [];
  for (const example of examples) if (!unique.some(e => distance(e.features, example.features) < 1e-8)) unique.push(example);
  return unique.length;
}
export function predict(examples: Example[], features: number[]): Style | null {
  if (distinctCount(examples) < 3) return null;
  const nearest = examples.map(e => ({ e, d: distance(e.features, features) })).sort((a, b) => a.d - b.d).slice(0, 3);
  if (nearest[0]!.d < 1e-10) return { ...nearest[0]!.e.style };
  const weights = nearest.map(n => 1 / (n.d + 0.0001));
  const total = weights.reduce((a, b) => a + b, 0);
  const blend = (key: keyof Style) => nearest.reduce((sum, n, i) => sum + n.e.style[key] * weights[i]!, 0) / total;
  const x = nearest.reduce((s, n, i) => s + Math.cos(n.e.style.hue * Math.PI / 180) * weights[i]!, 0);
  const y = nearest.reduce((s, n, i) => s + Math.sin(n.e.style.hue * Math.PI / 180) * weights[i]!, 0);
  return { hue: (Math.atan2(y, x) * 180 / Math.PI + 360) % 360, orbit: blend('orbit'), spread: blend('spread'), motion: blend('motion'), trails: blend('trails') };
}
export function parseLibrary(value: unknown): VisualLibrary {
  if (!value || typeof value !== 'object') throw new Error('Not a visual library.');
  const obj = value as Record<string, unknown>;
  if (obj['version'] !== 1) throw new Error('Unsupported visual library version.');
  const check = (input: unknown): Example[] => {
    if (!Array.isArray(input) || input.length > MAX_EXAMPLES) throw new Error('Library must contain at most 128 examples.');
    return input.map((e: unknown) => {
      if (!e || typeof e !== 'object') throw new Error('Invalid example.');
      const item = e as Example;
      if (typeof item.name !== 'string' || item.name.length > 80 || !Array.isArray(item.features) || item.features.length !== 9 || !item.features.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Invalid musical features.');
      if (!item.style || !['hue','orbit','spread','motion','trails'].every(k => {
        const n = item.style[k as keyof Style]; return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= (k === 'hue' ? 360 : 1);
      })) throw new Error('Invalid visual style.');
      return { name: item.name, features: [...item.features], style: { hue: item.style.hue, orbit: item.style.orbit, spread: item.style.spread, motion: item.style.motion, trails: item.style.trails } };
    });
  };
  return { version: 1, examples: check(obj['examples']), trained: check(obj['trained']) };
}
