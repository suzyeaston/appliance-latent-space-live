import { describe, expect, it } from 'vitest';
import { buildGroove } from '../../src/core/performance/grooves';
import { parsePattern } from '../../src/core/pattern/parse';
import { detectVisualDialect, musicalMetrics } from '../../src/core/visual/musicGrammar';

function score(text: string) {
  const parsed = parsePattern(text);
  if (!parsed.ok) throw new Error('test pattern failed to parse');
  return parsed.score;
}

describe('musical visual grammar', () => {
  it('preserves explicit DJ style as the visual dialect', () => {
    const house = score(buildGroove({root:0,scale:'minor',style:'house',rhythm:'four',tempo:124,density:.65,swing:.08}));
    const broken = score(buildGroove({root:0,scale:'minor',style:'broken',rhythm:'breaks',tempo:132,density:.8,swing:.22}));
    const dub = score(buildGroove({root:0,scale:'minor',style:'dub',rhythm:'half',tempo:74,density:.4,swing:.12}));
    expect(detectVisualDialect(house)).toBe('house');
    expect(detectVisualDialect(broken)).toBe('broken');
    expect(detectVisualDialect(dub)).toBe('dub');
  });

  it('can infer a slow sustained ambient score without a style comment', () => {
    const ambient = score(`tempo 64\nbars 2\ngrid 16\n\nvoice pad tone\n  wave sine\n  level 0.5\n  play [c4 e4 g4] _ _ _ _ _ _ _ _ _ _ _ _ _ _ _\n  play [a3 c4 e4] _ _ _ _ _ _ _ _ _ _ _ _ _ _ _\n`);
    expect(detectVisualDialect(ambient)).toBe('ambient');
  });

  it('reports musical features that the renderer can explain', () => {
    const house = score(buildGroove({root:0,scale:'minor',style:'house',rhythm:'four',tempo:124,density:.65,swing:.08}));
    const metrics = musicalMetrics(house);
    expect(metrics.tempo).toBe(124);
    expect(metrics.fourFloor).toBeGreaterThan(0.5);
    expect(metrics.percussion).toBeGreaterThan(0);
  });
});
