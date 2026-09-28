import { describe, it, expect } from 'vitest';
import { DEFAULT_STYLE, distinctCount, featuresFor, parseLibrary, predict, type Example } from '../../src/core/learning/visualModel';
import { parsePattern } from '../../src/core/pattern/parse';
import { EXAMPLES } from '../../src/core/pattern/examples';
const example = (x: number, hue: number): Example => ({ name: 'My study', features: Array(9).fill(x), style: { ...DEFAULT_STYLE, hue, orbit: x } });
describe('personal visual model', () => {
  it('never presents an untrained or duplicate-only library as learned', () => {
    expect(predict([],Array(9).fill(0))).toBeNull();
    expect(predict([example(0,20),example(0,20),example(0,20)],Array(9).fill(0))).toBeNull();
    expect(distinctCount([example(0,20),example(0,50)])).toBe(1);
  });
  it('recalls taught examples exactly and interpolates unseen phrases', () => {
    const data = [example(0,20),example(.5,50),example(1,80)];
    expect(predict(data,Array(9).fill(.5))).toEqual(data[1]!.style);
    const prediction = predict(data,Array(9).fill(.25))!;
    expect(prediction.orbit).toBeGreaterThan(0);
    expect(prediction.orbit).toBeLessThan(.5);
  });
  it('blends hues across the colour wheel seam', () => {
    const prediction = predict([example(0,350),example(.5,10),example(1,0)],Array(9).fill(.25))!;
    expect(Math.min(prediction.hue,360-prediction.hue)).toBeLessThan(15);
  });
  it('imports only bounded finite data and round trips valid libraries', () => {
    const data = { version:1, examples:[example(0,20)], trained:[] };
    expect(parseLibrary(JSON.parse(JSON.stringify(data)))).toEqual(data);
    expect(() => parseLibrary({...data,examples:[{...example(0,20), features:[NaN]}]})).toThrow();
    expect(() => parseLibrary({...data,examples:[{...example(0,20),style:{...DEFAULT_STYLE,motion:Infinity}}]})).toThrow();
    expect(() => parseLibrary({...data,examples:Array(129).fill(example(0,20))})).toThrow();
  });
  it('extracts distinct bounded features from music and tone settings', () => {
    const features = EXAMPLES.map(e => {
      const parsed = parsePattern(e.source); if (!parsed.ok) throw new Error('bad fixture');
      const values = featuresFor(parsed.score,{});
      expect(values).toHaveLength(9);
      expect(values.every(v => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
      expect(featuresFor(parsed.score,{destruction:1})).not.toEqual(values);
      return values;
    });
    expect(new Set(features.map(f => JSON.stringify(f))).size).toBe(3);
  });
});
