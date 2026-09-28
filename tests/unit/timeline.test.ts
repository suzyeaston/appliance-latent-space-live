import {describe,it,expect} from 'vitest';
import {Timeline,readBlocks} from '../../src/core/performance/timeline';
import {parsePattern} from '../../src/core/pattern/parse';
import {Sequencer,type ScheduledNote} from '../../src/core/sequencer';
import {readSet} from '../../src/ui/dj';
const phrase=(note:string,bars:number)=>`tempo 120\nbars ${bars}\ngrid 4\nvoice lead tone\nplay ${note} . . .`;
const scenes=[{name:'A',pattern:phrase('c4',2)},{name:'B',pattern:phrase('e4',1)},null,null];
const blocks=[0,null,1,null,null,null,null,null];
describe('musical block timeline',()=>{
  it('plays every bar of a scene, skips empty blocks and loops',()=>{
    const t=new Timeline();t.start(scenes,blocks);
    expect(t.nextBar()?.block).toBe(0);
    expect(t.nextBar()).toBeNull();
    expect(t.nextBar()?.block).toBe(2);
    expect(t.nextBar()?.block).toBe(0);
  });
  it('can cue a chosen block and snapshots the set until restarted',()=>{
    const data=structuredClone(scenes), t=new Timeline();t.start(data,blocks,2);
    data[1]!.pattern=phrase('g4',1);
    expect(t.nextBar()?.scene.pattern).toBe(scenes[1]!.pattern);
    t.stop();expect(t.nextBar()).toBeNull();expect(t.active).toBe(false);
  });
  it('refuses empty or invalid arrangements',()=>{
    expect(()=>new Timeline().start(scenes,Array(8).fill(null))).toThrow();
    expect(()=>readBlocks([9,null,null,null,null,null,null,null])).toThrow();
    expect(()=>readBlocks([0])).toThrow();
    expect(()=>readBlocks([NaN,null,null,null,null,null,null,null])).toThrow();
  });
  it('replaces the actual score at the boundary and restarts each block from bar one',()=>{
    const t=new Timeline();t.start(scenes,blocks);
    const initial=parsePattern(phrase('g4',3));if(!initial.ok)throw new Error('fixture');
    let now=0;const notes:ScheduledNote[]=[];const barNumbers:number[]=[];
    const seq=new Sequencer(initial.score,{
      now:()=>now,onNotes:n=>notes.push(...n),onBar:b=>barNumbers.push(b.bar),
      beforeBar:()=>{const next=t.nextBar();if(!next)return null;const p=parsePattern(next.scene.pattern);return p.ok?p.score:null;},
    });
    seq.start(0);for(let i=0;i<165;i++){now=i*.04;seq.tick();}
    expect(notes.slice(0,4).map(n=>n.event.pitches[0])).toEqual([60,60,64,60]);
    expect(barNumbers.slice(0,4)).toEqual([0,1,0,0]);
    expect(notes[2]!.time-notes[0]!.time).toBeCloseTo(4);
    t.stop();seq.stop();const count=notes.length;now+=10;seq.tick();expect(notes.length).toBe(count);
  });
  it('keeps old scene sets readable and supports new sets',()=>{
    expect(readSet({version:1,scenes})).toEqual(scenes);
    expect(readSet({version:2,scenes,blocks})).toEqual(scenes);
    expect(readBlocks(blocks)).toEqual(blocks);
  });
});
