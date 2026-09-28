import { formatScore } from '../pattern/format';
import { parsePattern } from '../pattern/parse';
import type { Score, Voice, PercHit } from '../pattern/types';
export const SCALES: Record<string, number[]> = { minor:[0,2,3,5,7,8,10], major:[0,2,4,5,7,9,11], dorian:[0,2,3,5,7,9,10], pentatonic:[0,3,5,7,10] };
export const STYLES = ['house','broken','dub','ambient','electro'] as const;
export type MusicStyle = typeof STYLES[number];
export const RHYTHMS = ['four','breaks','half','sparse'] as const;
export type Rhythm = typeof RHYTHMS[number];
export type Groove = { root: number; scale: string; style: MusicStyle; rhythm: Rhythm; tempo: number; density: number; swing: number };
export const STYLE_DEFAULTS: Record<MusicStyle,{tempo:number;rhythm:Rhythm;density:number;swing:number}> = {
  house:{tempo:124,rhythm:'four',density:.65,swing:.08}, broken:{tempo:132,rhythm:'breaks',density:.8,swing:.22},
  dub:{tempo:74,rhythm:'half',density:.4,swing:.12},ambient:{tempo:66,rhythm:'sparse',density:.2,swing:0},
  electro:{tempo:116,rhythm:'breaks',density:.7,swing:.05},
};
function voice(name:string,kind:Voice['kind'],wave:Voice['wave'],level:number,bars:number):Voice {
  return {name,kind,wave,level,muted:false,octave:0,writtenBars:bars};
}
const DRUMS:Record<Rhythm,Record<'kick'|'snare'|'hat',number[]>> = {
  four:{kick:[0,4,8,12],snare:[4,12],hat:[2,6,10,14]},
  breaks:{kick:[0,6,10],snare:[4,12],hat:[0,2,4,6,8,10,12,14]},
  half:{kick:[0,7,14],snare:[8],hat:[2,6,10,14]},
  sparse:{kick:[0],snare:[],hat:[6,14]},
};
export function swapRhythm(input:Score,rhythm:Rhythm,density:number):Score {
  if (!RHYTHMS.includes(rhythm) || !Number.isFinite(density) || density<0 || density>1) throw new Error('Invalid rhythm settings.');
  const score=structuredClone(input);
  const keep=score.voices.map((v,i)=>v.kind==='perc'?-1:i).filter(i=>i>=0);
  if(keep.length>5) throw new Error('Rhythm needs three drum lanes. Keep at most five melodic voices.');
  score.events=score.events.filter(e=>keep.includes(e.voice)).map(e=>({...e,voice:keep.indexOf(e.voice)}));
  score.voices=keep.map(i=>score.voices[i]!);
  for(const hit of ['kick','snare','hat'] as const){
    let name=`dj_${hit}`; while(score.voices.some(v=>v.name===name)) name+='x';
    const index=score.voices.length; score.voices.push(voice(name,'perc','sine',hit==='hat'?.35:.65,score.bars));
    for(let bar=0;bar<score.bars;bar++){
      const steps=new Set(DRUMS[rhythm][hit].map(s=>Math.floor(s*score.grid/16)));
      if(hit==='hat'&&density>.7) for(let s=1;s<16;s+=2) steps.add(Math.floor(s*score.grid/16));
      if(hit==='snare'&&density>.85&&bar%2===1) steps.add(Math.floor(15*score.grid/16));
      for(const step of steps) score.events.push({voice:index,step:bar*score.grid+step,steps:1,pitches:[],hit:hit as PercHit,velocity:hit==='hat'?.38:.8,line:1});
    }
  }
  score.events.sort((a,b)=>a.step-b.step||a.voice-b.voice);return score;
}
export function buildGroove(config:Groove):string {
  const scale=SCALES[config.scale];
  if(!scale||!STYLES.includes(config.style)||!Number.isInteger(config.root)||config.root<0||config.root>11||!Number.isFinite(config.tempo)||config.tempo<20||config.tempo>300||!Number.isFinite(config.swing)||config.swing<0||config.swing>.45) throw new Error('Invalid groove settings.');
  const score:Score={tempo:config.tempo,bars:4,grid:16,swing:config.swing,voices:[],events:[],totalSteps:64,source:''};
  const ambient=config.style==='ambient',dub=config.style==='dub',electro=config.style==='electro';
  score.voices=[voice('harmony','tone',electro?'square':ambient?'sine':'triangle',.36,4),voice('low','bass',electro?'saw':'sine',.65,4)];
  const degree=(n:number,octave:number)=>12*(octave+1)+config.root+scale[n%scale.length]!;
  for(let bar=0;bar<4;bar++){
    const tonic=[0,5,3,4][bar]!%scale.length;
    const at=bar*16;
    const chord=[0,2,4].map(n=>degree((tonic+n)%scale.length,3));
    const onsets=ambient?[0]:dub?[2,10]:[0,6,10,14];
    for(const step of onsets.slice(0,Math.max(1,Math.ceil(onsets.length*config.density)))) score.events.push({voice:0,step:at+step,steps:ambient?12:dub?2:1,pitches:chord,velocity:.65,line:1});
    if(config.density>.55&&!ambient) score.events.push({voice:0,step:at+15,steps:1,pitches:[degree((tonic+6)%scale.length,4)],velocity:.4,line:1});
    for(const step of (ambient?[0]:dub?[0,7]:[0,3,8,11])) score.events.push({voice:1,step:at+step,steps:ambient?14:2,pitches:[degree(tonic,1)],velocity:step===0?.85:.6,line:1});
  }
  const result=formatScore(swapRhythm(score,config.rhythm,config.density),`${config.style} / root ${config.root} / ${config.scale}\nAuthored rule-based sketch; not AI or learned musical style.`);
  if(!parsePattern(result).ok) throw new Error('Generated groove failed validation.'); return result;
}
export function transpose(input:Score,semitones:number):Score {
  if(!Number.isInteger(semitones)||Math.abs(semitones)>12) throw new Error('Transpose by at most one octave.');
  const result=structuredClone(input);
  for(const event of result.events) event.pitches=event.pitches.map(p=>{
    const n=p+semitones; if(n<12||n>108)throw new Error('Transposition exceeds the instrument range.');return n;
  });return result;
}
