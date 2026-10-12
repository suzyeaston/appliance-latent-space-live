import { describe, it, expect } from 'vitest';
import { stagePoint, writeGesture } from '../../src/core/performance/gesture';
import { readVocal, spectrumTimbre, VOCAL_RATE } from '../../src/core/audio/vocals';
import { moveBlock, Timeline } from '../../src/core/performance/timeline';
import { parsePattern } from '../../src/core/pattern/parse';
import { formatScore } from '../../src/core/pattern/format';
import { readSet } from '../../src/ui/dj';
import { waveHue } from '../../src/core/visual/renderer';

const source = 'tempo 120\nbars 1\ngrid 4\nvoice lead tone\nplay c4 . e4 .';
const take = { name: 'Voice', samples: btoa('\0'.repeat(VOCAL_RATE * 2)), fx: { level: .7, tone: .8, drive: .2, echo: .3 } };

describe('direct visual performance', () => {
  it('maps independent pitch and timbre axes with bounded values', () => {
    expect(stagePoint(-10,2)).toEqual({timbre:0,midi:48,wave:'sine'});
    expect(stagePoint(4,-2)).toEqual({timbre:1,midi:84,wave:'square'});
    expect(stagePoint(.7,.5).midi).toBe(66);
  });
  it('overdubs a playable lane and preserves existing music', () => {
    const parsed = parsePattern(source); if (!parsed.ok) throw new Error('fixture');
    const next = writeGesture(parsed.score,[{step:0,midi:64},{step:1,midi:67},{step:1,midi:69}], 'saw');
    expect(next.events.filter(e => e.voice===0)).toEqual(parsed.score.events);
    const roundtrip = parsePattern(formatScore(next)); if (!roundtrip.ok) throw new Error('gesture must parse');
    expect(roundtrip.score.events.filter(e=>e.voice===1).map(e=>e.pitches[0])).toEqual([64,69]);
    expect(parsed.score.voices).toHaveLength(1);
    expect(writeGesture(next,[{step:0,midi:72}],'square').voices).toHaveLength(2);
  });
  it('distinguishes waveform and spectral brightness independently of energy', () => {
    expect(waveHue('sine')).not.toBe(waveHue('square'));
    expect(spectrumTimbre(new Uint8Array(10))).toEqual({brightness:0,edge:0});
    const low = spectrumTimbre(Uint8Array.from([0,200,0,0]));
    const high = spectrumTimbre(Uint8Array.from([0,0,0,200]));
    expect(high.brightness).toBeGreaterThan(low.brightness);
    expect(high.edge).toBeGreaterThan(low.edge);
    expect(spectrumTimbre(Uint8Array.from([0,100,0,0]))).toEqual(low);
  });
});

describe('recorded scene data', () => {
  it('roundtrips recordings and FX in a version 3 set while preserving legacy sets', () => {
    const scenes = [{name:'A',pattern:source,vocal:take},null,null,null];
    expect(readSet(JSON.parse(JSON.stringify({version:3,scenes})))).toEqual(scenes);
    expect(readSet({version:1,scenes:[{name:'Old',pattern:source},null,null,null]})[0]?.vocal).toBeUndefined();
    expect(()=>readSet({version:'3',scenes})).toThrow();
  });
  it('rejects malformed samples, oversize clips, and invalid FX', () => {
    expect(()=>readVocal({...take,samples:'not audio!'})).toThrow();
    expect(()=>readVocal({...take,samples:btoa('x')})).toThrow();
    expect(()=>readVocal({...take,samples:btoa('\0'.repeat(VOCAL_RATE*21*2))})).toThrow();
    expect(()=>readVocal({...take,fx:{...take.fx,echo:Infinity}})).toThrow();
    expect(readVocal(null)).toBeNull();
  });
  it('snapshots vocal data and FX along with music for bar-boundary transitions', () => {
    const scenes = [{name:'A',pattern:source,vocal:structuredClone(take)},null,null,null];
    const timeline = new Timeline();timeline.start(scenes,[0,null,null,null,null,null,null,null]);
    scenes[0]!.vocal.fx.echo=1;
    expect(timeline.nextBar()?.scene.vocal?.fx.echo).toBe(.3);
  });
});

describe('block ordering', () => {
  it('moves blocks through empty slots and keeps repeated scene references', () => {
    const blocks = [0,1,null,0,null,null,null,null];
    expect(moveBlock(blocks,0,3)).toEqual([1,null,0,0,null,null,null,null]);
    expect(blocks).toEqual([0,1,null,0,null,null,null,null]);
    expect(moveBlock(blocks,3,0)).toEqual([0,0,1,null,null,null,null,null]);
    expect(()=>moveBlock(blocks,0,8)).toThrow();
  });
});
