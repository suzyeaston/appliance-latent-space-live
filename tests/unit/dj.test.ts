import {describe,it,expect} from 'vitest';
import {buildGroove,SCALES,STYLES,RHYTHMS,swapRhythm,transpose} from '../../src/core/performance/grooves';
import {parsePattern} from '../../src/core/pattern/parse';
import {formatScore} from '../../src/core/pattern/format';
import {Sequencer,type ScheduledNote} from '../../src/core/sequencer';
import {readSet} from '../../src/ui/dj';
const source=buildGroove({root:9,scale:'minor',style:'house',rhythm:'four',tempo:120,density:.65,swing:.2});
function parsed(text=source){const result=parsePattern(text);if(!result.ok)throw new Error(JSON.stringify(result.errors));return result.score;}
describe('DJ musical controls',()=>{
  it('builds playable grooves in every key, scale, style and rhythm',()=>{
    for(let root=0;root<12;root++)for(const scale of Object.keys(SCALES))for(const style of STYLES)for(const rhythm of RHYTHMS){
      const score=parsed(buildGroove({root,scale,style,rhythm,tempo:120,density:.8,swing:.3}));
      expect(score.voices.length).toBeLessThanOrEqual(8);
      for(const e of score.events)for(const pitch of e.pitches)expect(SCALES[scale]).toContain(((pitch-root)%12+12)%12);
    }
  });
  it('retains melody and bass when swapping rhythm',()=>{
    const score=parsed();const changed=swapRhythm(score,'half',.5);
    expect(changed.events.filter(e=>!e.hit)).toEqual(score.events.filter(e=>!e.hit));
    expect(changed.events.filter(e=>e.hit)).not.toEqual(score.events.filter(e=>e.hit));
    expect(parsed(formatScore(changed)).swing).toBe(.2);
  });
  it('transposes all pitched notes and leaves drums unchanged',()=>{
    const score=parsed();const shifted=transpose(score,1);
    score.events.forEach((event,i)=>expect(shifted.events[i]!.pitches).toEqual(event.pitches.map(p=>p+1)));
    expect(shifted.events.filter(e=>e.hit)).toEqual(score.events.filter(e=>e.hit));
    score.events[0]!.pitches=[108];expect(()=>transpose(score,1)).toThrow();
  });
  it('saves swing in pattern code and validates its range',()=>{
    expect(parsed(formatScore(parsed())).swing).toBe(.2);
    expect(parsePattern(source.replace('swing 0.2','swing 0.9')).ok).toBe(false);
    expect(parsePattern(source.replace('swing 0.2','swing NaN')).ok).toBe(false);
  });
  it('actually delays offbeats without moving bar starts or losing order',()=>{
    const score=parsed('tempo 120\nswing 0.4\nbars 1\ngrid 4\nvoice lead tone\nplay c4 d4 e4 f4');
    let time=0;const notes:ScheduledNote[]=[];const bars:number[]=[];
    const seq=new Sequencer(score,{now:()=>time,onNotes:n=>notes.push(...n),onBar:b=>bars.push(b.time)});
    seq.start(0);for(let i=0;i<60;i++){time=i*.04;seq.tick();}
    expect(notes[1]!.time-notes[0]!.time).toBeCloseTo(.7);
    expect(notes[2]!.time-notes[1]!.time).toBeCloseTo(.3);
    expect(bars[1]!-bars[0]!).toBeCloseTo(2);
    expect(notes.every(n=>n.duration>0)).toBe(true);
  });
  it('validates scene libraries without accepting malformed data',()=>{
    const value={version:1,scenes:[{name:'Opening',pattern:source},null,null,null]};
    expect(readSet(value)[0]?.pattern).toBe(source);
    expect(()=>readSet({...value,scenes:[{name:'bad',pattern:'bad'},null,null,null]})).toThrow();
    expect(()=>readSet({...value,version:3})).toThrow();
  });
});
