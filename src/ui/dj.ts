import { Timeline, readBlocks, moveBlock, type TimelineBlocks } from '../core/performance/timeline';
import { readVocal, type VocalTake } from '../core/audio/vocals';
import { buildGroove, STYLE_DEFAULTS, swapRhythm, transpose, type MusicStyle, type Rhythm } from '../core/performance/grooves';
import { formatScore } from '../core/pattern/format';
import { parsePattern } from '../core/pattern/parse';
import type { Score } from '../core/pattern/types';
import { el } from './dom';
export type Scene = {name:string;pattern:string;vocal?:VocalTake|null};
export function readSet(value:unknown):Array<Scene|null> {
  if(!value || typeof value!=='object')throw new Error('Not a DJ set.');
  const obj=value as {version?:unknown;scenes?:unknown};
  if(![1,2,3].includes(obj.version as number)||!Array.isArray(obj.scenes)||obj.scenes.length!==4)throw new Error('Expected a version 1, 2 or 3 set with four slots.');
  return obj.scenes.map((v:unknown)=>{
    if(v===null)return null;
    if(typeof v!=='object'||!v)throw new Error('Invalid scene.');
    const scene=v as Scene;
    if(typeof scene.name!=='string'||scene.name.length>60||typeof scene.pattern!=='string'||scene.pattern.length>200000||!parsePattern(scene.pattern).ok)throw new Error('Scene contains an invalid musical pattern.');
    return {name:scene.name,pattern:scene.pattern,...(scene.vocal !== undefined ? {vocal:readVocal(scene.vocal)} : {})};
  });
}
interface Options { start:()=>Promise<boolean>; source:()=>string; load:(pattern:string)=>void; running:()=>boolean;
  vocal?:()=>VocalTake|null; selectVocal?:(take:VocalTake|null)=>void; scenesChanged?:(scenes:Array<Scene|null>)=>void }
export class DJ {
  private scenes:Array<Scene|null>=[null,null,null,null];
  private history:string[]=[];
  private timeline=new Timeline();
  private blocks:TimelineBlocks=Array(8).fill(null);
  private options:Options;
  private status=el<HTMLElement>('dj-status');
  private dragging=false;
  constructor(options:Options){
    this.options=options;
    try{const saved=localStorage.getItem('als-dj-set-v1');if(saved){const data=JSON.parse(saved);this.scenes=readSet(data);if(data.version>=2)this.blocks=readBlocks(data.blocks);}}
    catch{this.status.textContent='Could not restore set storage. Use Export set to keep your scenes.';}
    el<HTMLSelectElement>('dj-style').onchange=()=>{
      const preset=STYLE_DEFAULTS[this.value('dj-style') as MusicStyle];

      el<HTMLSelectElement>('dj-rhythm').value=preset.rhythm;
      el<HTMLInputElement>('dj-density').value=String(preset.density);
      el<HTMLInputElement>('dj-swing').value=String(preset.swing);
      this.status.textContent='Style settings ready. Build / queue groove to hear them.';
    };
    el<HTMLButtonElement>('dj-build').onclick=()=>this.attempt(()=>{
      this.score();
      const tempo=Number(this.value('quick-tempo'));
      const text=buildGroove({root:Number(this.value('dj-root')),scale:this.value('dj-scale'),style:this.value('dj-style') as MusicStyle,rhythm:this.value('dj-rhythm') as Rhythm,tempo,density:Number(this.value('dj-density')),swing:Number(this.value('dj-swing'))});
      this.load(text,'New groove');
    });
    el<HTMLButtonElement>('dj-drums').onclick=()=>this.attempt(()=>{
      this.load(formatScore(swapRhythm(this.score(),this.value('dj-rhythm') as Rhythm,Number(this.value('dj-density')))),'Drum change');
    });
    el<HTMLButtonElement>('dj-apply-swing').onclick=()=>this.attempt(()=>{
      const score=this.score();score.swing=Number(this.value('dj-swing'));this.load(formatScore(score),'Swing change');
    });
    for(const [id,amount]of [['dj-down',-1],['dj-up',1]] as const)el<HTMLButtonElement>(id).onclick=()=>this.attempt(()=>this.load(formatScore(transpose(this.score(),amount)),`Transpose ${amount>0?'+':''}${amount}`));
    el<HTMLButtonElement>('dj-breakdown').onclick=()=>this.attempt(()=>{
      const score=this.score();score.voices.forEach(v=>{if(v.kind==='perc')v.muted=true;});this.load(formatScore(score),'Drum breakdown');
    });
    el<HTMLButtonElement>('dj-undo').onclick=()=>{
      const previous=this.history.pop();if(!previous)return;options.load(previous);this.status.textContent=options.running()?'Undo queued for the next bar.':'Previous phrase restored.';
      el<HTMLButtonElement>('dj-undo').disabled=!this.history.length;
    };
    el<HTMLButtonElement>('dj-export').onclick=()=>{
      const url=URL.createObjectURL(new Blob([JSON.stringify({version:3,scenes:this.scenes,blocks:this.blocks},null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='my-appliance-dj-set.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    el<HTMLInputElement>('dj-import').onchange=async e=>{
      const input=e.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;
      try{
        if(file.size>5000000)throw new Error('Set file must be under 5 MB.');
        const data=JSON.parse(await file.text());
        const scenes=readSet(data);
        const blocks=data.version>=2?readBlocks(data.blocks):Array(8).fill(null);
        if(this.scenes.some(Boolean)&&!window.confirm('Replace the four saved scene slots? Export the current set first to keep it.'))return;
        this.stopTimeline();this.scenes=scenes;this.blocks=blocks;this.renderSlots();this.persist();this.status.textContent='Set imported. Launch any saved scene.';
      }catch(error){this.status.textContent=String(error);}finally{input.value='';}
    };
    el<HTMLButtonElement>('timeline-play').onclick=()=>void this.runTimeline();
    el<HTMLButtonElement>('timeline-stop').onclick=()=>this.stopTimeline();
    el<HTMLButtonElement>('timeline-add').onclick=()=>this.attempt(()=>{
      this.score();
      const sceneIndex=this.scenes.findIndex(s=>s===null);
      const blockIndex=this.blocks.findIndex(s=>s===null);
      if(sceneIndex<0)throw new Error('All four scenes are saved. Choose one in a block, or replace a scene below.');
      if(blockIndex<0)throw new Error('All eight blocks are assigned. Clear a block to add another phrase.');
      this.stopTimeline();
      this.scenes[sceneIndex]={name:`Phrase ${sceneIndex+1}`,pattern:this.options.source(),vocal:this.options.vocal?.()??null};
      this.blocks[blockIndex]=sceneIndex;this.renderSlots();this.persist();
      el('timeline-status').textContent=`Phrase saved in block ${blockIndex+1}. Change the music and add another, or press Play timeline.`;
    });
    this.renderSlots();
  }
  private value(id:string):string{return el<HTMLInputElement>(id).value;}
  private score():Score{
    const parsed=parsePattern(this.options.source());if(!parsed.ok)throw new Error('Fix the code errors before changing the groove.');return parsed.score;
  }
  private attempt(action:()=>void):void{try{action();}catch(error){this.status.textContent=error instanceof Error?error.message:'Unable to change the phrase.';}}
  private load(text:string,label:string):void{
    if(!parsePattern(text).ok)throw new Error('This change did not produce playable music.');
    this.history.push(this.options.source());if(this.history.length>20)this.history.shift();
    this.options.load(text);el<HTMLButtonElement>('dj-undo').disabled=false;
    this.status.textContent=`${label}${this.options.running()?' queued for the next bar.':' ready. Press Start.'} Undo returns to the previous phrase.`;
  }
  private renderSlots():void{
    this.renderTimeline();
    const area=el('dj-scenes');area.replaceChildren();
    this.scenes.forEach((scene,index)=>{
      const card=document.createElement('div');card.className='scene-card';
      card.dataset['sceneIndex']=String(index);
      const handle=this.dragHandle(`Drag scene ${index+1}`,{scene:index},!!scene);
      const label=document.createElement('label');label.textContent=`SCENE ${index+1}`;
      const name=document.createElement('input');name.value=scene?.name??`Scene ${index+1}`;name.maxLength=60;name.setAttribute('aria-label',`Scene ${index+1} name`);
      const save=document.createElement('button');save.className='btn';save.textContent=scene?'Replace scene':'Save current phrase';save.type='button';
      save.onclick=()=>this.attempt(()=>{
        this.score();if(this.scenes[index]&&!window.confirm(`Replace saved scene ${index+1}?`))return;
        this.stopTimeline();this.scenes[index]={name:name.value.trim()||`Scene ${index+1}`,pattern:this.options.source(),vocal:this.options.vocal?.()??null};
        this.renderSlots();this.status.textContent=`Scene ${index+1} saved from the editor, including any queued change.`;this.persist();
      });
      const launch=document.createElement('button');launch.className='btn btn--start';launch.textContent='Launch';launch.type='button';launch.disabled=!scene;
      launch.setAttribute('aria-label',`Launch scene ${index+1}`);
      launch.onclick=()=>this.attempt(()=>{const saved=this.scenes[index];if(!saved)return;
        let pattern=saved.pattern;
        if(el<HTMLInputElement>('dj-keep-tempo').checked){const parsed=parsePattern(pattern);if(parsed.ok){parsed.score.tempo=this.score().tempo;pattern=formatScore(parsed.score);}}
        this.load(pattern,saved.name);
        this.options.selectVocal?.(saved.vocal??null);
      });
      const vocal=document.createElement('span');vocal.className='hint';vocal.textContent=scene?.vocal?`Vocal: ${scene.vocal.name}`:'No vocal take';
      label.append(name);card.append(handle,label,vocal,launch,save);area.append(card);
    });
    this.options.scenesChanged?.(this.scenes);
  }
  private async runTimeline(from=0):Promise<void>{
    try{
      this.timeline.start(this.scenes,this.blocks,from);
      el('timeline-status').textContent='Timeline queued for the next bar. Assigned blocks loop in order.';
      this.renderTimeline();
      if(!await this.options.start()) { this.stopTimeline();el('timeline-status').textContent='Audio did not start. Press Start, then try Play timeline again.'; }
    }catch(error){this.stopTimeline();el('timeline-status').textContent=error instanceof Error?error.message:'Could not start timeline.';}
  }
  nextTimelineBar():string|null{
    const next=this.timeline.nextBar();if(!next)return null;
    const parsed=parsePattern(next.scene.pattern);if(!parsed.ok){this.stopTimeline();return null;}
    if(el<HTMLInputElement>('dj-keep-tempo').checked)parsed.score.tempo=this.score().tempo;
    this.options.selectVocal?.(next.scene.vocal??null);
    this.renderTimeline();
    el('timeline-status').textContent=`Block ${next.block+1} · ${next.scene.name} · ${parsed.score.bars} bars · looping arrangement`;
    return formatScore(parsed.score);
  }
  stopTimeline(silenced=false):void{
    const wasActive=this.timeline.active;this.timeline.stop();
    if(wasActive)el('timeline-status').textContent=silenced?'Timeline and playback stopped.':'Timeline chaining stopped. The current phrase keeps looping; Stop silences it.';
    this.renderTimeline();
  }
  private renderTimeline():void{
    if(this.dragging)return;
    const area=el('timeline-blocks');area.replaceChildren();
    this.blocks.forEach((slot,index)=>{
      const card=document.createElement('div');card.className='timeline-block';
      card.dataset['blockIndex']=String(index);
      if(this.timeline.active&&this.timeline.block===index){card.classList.add('is-playing');card.setAttribute('aria-current','step');}
      const label=document.createElement('label');label.textContent=String(index+1).padStart(2,'0');
      const select=document.createElement('select');select.setAttribute('aria-label',`Timeline block ${index+1} scene`);
      const empty=document.createElement('option');empty.value='';empty.textContent='Empty';select.append(empty);
      this.scenes.forEach((scene,i)=>{if(!scene)return;const option=document.createElement('option');option.value=String(i);option.textContent=scene.name;select.append(option);});
      select.value=slot===null?'':String(slot);
      select.onchange=()=>{this.stopTimeline();this.blocks[index]=select.value===''?null:Number(select.value);this.renderTimeline();this.persist();};
      const length=document.createElement('span');const scene=slot===null?null:this.scenes[slot];const parsed=scene?parsePattern(scene.pattern):null;
      length.textContent=parsed?.ok?`${parsed.score.bars} bars`:'Assign a scene';
      const cue=document.createElement('button');cue.type='button';cue.className='btn';cue.textContent='Play from here';cue.disabled=!scene;cue.onclick=()=>void this.runTimeline(index);
      const handle=this.dragHandle(`Move block ${index+1}`,{block:index},true);
      const moves=document.createElement('div');moves.className='block-moves';
      for(const [text,offset] of [['←',-1],['→',1]] as const){
        const button=document.createElement('button');button.type='button';button.className='btn btn--small';button.textContent=text;
        button.setAttribute('aria-label',`Move block ${index+1} ${offset<0?'left':'right'}`);button.disabled=index+offset<0||index+offset>=8;
        button.onclick=()=>this.reorder(index,index+offset);moves.append(button);
      }
      label.append(select);card.append(handle,label,length,cue,moves);area.append(card);
    });
    el<HTMLButtonElement>('timeline-stop').disabled=!this.timeline.active;
  }
  attachVocal(index:number):void{
    if(!Number.isInteger(index)||!this.scenes[index])return;
    this.stopTimeline();this.scenes[index]!.vocal=this.options.vocal?.()??null;
    this.renderSlots();this.persist();el('vocal-status').textContent=`Take and FX saved to scene ${index+1}. Export your set to keep the recording.`;
  }
  private reorder(from:number,to:number):void{
    this.stopTimeline();this.blocks=moveBlock(this.blocks,from,to);this.renderTimeline();this.persist();
    el('timeline-status').textContent=`Moved block ${from+1} to ${to+1}. Press Play timeline to use the new order.`;
    el('timeline-blocks').querySelector<HTMLButtonElement>(`[data-block-index="${to}"] .drag-handle`)?.focus();
  }
  private dragHandle(label:string,payload:{block?:number;scene?:number},enabled:boolean):HTMLButtonElement{
    const handle=document.createElement('button');handle.type='button';handle.className='drag-handle';handle.textContent='⠿ Drag';handle.setAttribute('aria-label',label);handle.disabled=!enabled;
    let pointer:number|null=null, startX=0, startY=0, moved=false, scrollFrame=0, scrollSpeed=0;
    const clearDrag=()=>{pointer=null;this.dragging=false;window.cancelAnimationFrame(scrollFrame);scrollFrame=0;scrollSpeed=0;handle.classList.remove('is-dragging');document.querySelectorAll('.drop-target').forEach(e=>e.classList.remove('drop-target'));};
    handle.onpointerdown=e=>{if(e.button!==0)return;pointer=e.pointerId;this.dragging=true;startX=e.clientX;startY=e.clientY;moved=false;handle.setPointerCapture(e.pointerId);};
    handle.onpointermove=e=>{
      if(e.pointerId!==pointer)return;moved ||= Math.hypot(e.clientX-startX,e.clientY-startY)>6;
      if(moved){
        handle.classList.add('is-dragging');
        document.querySelectorAll('.drop-target').forEach(e=>e.classList.remove('drop-target'));
        document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-block-index], [data-scene-index]')?.classList.add('drop-target');
        scrollSpeed=e.clientY<60?-10:e.clientY>window.innerHeight-60?10:0;
        if(!scrollFrame){const scroll=()=>{if(pointer===null)return;window.scrollBy(0,scrollSpeed);scrollFrame=window.requestAnimationFrame(scroll);};scrollFrame=window.requestAnimationFrame(scroll);}
      }
    };
    handle.onpointerup=e=>{
      if(e.pointerId!==pointer)return;clearDrag();
      if(!moved)return;
      const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-block-index], [data-scene-index]');if(!target)return;
      const block=target.dataset['blockIndex'];
      if(block!==undefined){
        const to=Number(block);
        if(payload.block!==undefined&&payload.block!==to)this.reorder(payload.block,to);
        else if(payload.scene!==undefined){this.stopTimeline();this.blocks[to]=payload.scene;this.renderTimeline();this.persist();el('timeline-status').textContent=`Scene ${payload.scene+1} assigned to block ${to+1}.`;}
      } else if(payload.scene!==undefined){
        const to=Number(target.dataset['sceneIndex']);const from=payload.scene;if(from===to)return;
        this.stopTimeline();[this.scenes[from],this.scenes[to]]=[this.scenes[to]!,this.scenes[from]!];
        this.blocks=this.blocks.map(v=>v===from?to:v===to?from:v);this.renderSlots();this.persist();
        this.status.textContent=`Scene ${from+1} moved to ${to+1}. Timeline references were preserved.`;
      }
    };
    handle.onpointercancel=clearDrag;
    handle.onlostpointercapture=clearDrag;
    handle.onkeydown=e=>{if(payload.block===undefined||!['ArrowLeft','ArrowRight'].includes(e.key))return;
      e.preventDefault();const to=payload.block+(e.key==='ArrowLeft'?-1:1);if(to>=0&&to<8)this.reorder(payload.block,to);
    };
    return handle;
  }
  private persist():void{try{localStorage.setItem('als-dj-set-v1',JSON.stringify({version:3,scenes:this.scenes,blocks:this.blocks}));}catch{this.status.textContent+=' Set storage failed; export your set now.';}}
}
