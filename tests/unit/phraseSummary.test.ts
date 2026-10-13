import { describe,it,expect } from 'vitest';
import { firstHarmony,phraseSummary } from '../../src/core/performance/phraseSummary';
import { parsePattern } from '../../src/core/pattern/parse';
import { defaultExample } from '../../src/core/pattern/examples';
const parse=(source:string)=>{const result=parsePattern(source);if(!result.ok)throw new Error('fixture');return result.score;};
describe('current phrase disclosure',()=>{
  it('shows the shipped example opens in A minor, rather than inferring C major from white notes',()=>{
    const score=parse(defaultExample().source);
    expect(firstHarmony(score)).toBe('first chord: A minor');
    expect(phraseSummary(score)).toContain('Service Elevator');
  });
  it('identifies a restored major triad and a minor inversion from the actual notes',()=>{
    const source='tempo 104\nbars 1\ngrid 4\nvoice lead tone\nplay [c4 e4 g4] . . .';
    expect(firstHarmony(parse(source))).toBe('first chord: C major');
    expect(firstHarmony(parse(source.replace('[c4 e4 g4]','[c4 e4 a4]')))).toBe('first chord: A minor');
  });
  it('does not claim a key for custom, single-note, or drum-only patterns',()=>{
    const source='tempo 104\nbars 1\ngrid 4\nvoice lead tone\nplay c4 . . .';
    expect(phraseSummary(parse(source))).toBe('Custom / edited phrase · opening note: C');
    expect(firstHarmony(parse(source.replace('lead tone','drums perc').replace('c4','kick')))).toBe('no pitched notes');
  });
});
