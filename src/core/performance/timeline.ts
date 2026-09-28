import { parsePattern } from '../pattern/parse';
export interface TimelineScene { name:string; pattern:string }
export type TimelineBlocks = Array<number|null>;
export function readBlocks(value:unknown):TimelineBlocks {
  if(!Array.isArray(value)||value.length!==8||!value.every(v=>v===null||(Number.isInteger(v)&&v>=0&&v<4))) throw new Error('Timeline must have eight blocks referencing scenes 1–4 or empty.');
  return [...value];
}
/** Snapshot a set when it starts. Advance only from the sequencer's bar boundary. */
export class Timeline {
  private sequence:Array<{block:number;scene:TimelineScene;bars:number}>=[];
  private cursor=0;
  private remaining=0;
  active=false;
  block:number|null=null;
  start(scenes:Array<TimelineScene|null>,blocks:TimelineBlocks,from=0):void {
    this.stop();
    this.sequence=readBlocks(blocks).flatMap((slot,block)=>{
      const scene=slot===null?null:scenes[slot];if(!scene)return [];
      const parsed=parsePattern(scene.pattern);if(!parsed.ok)throw new Error('A scene has invalid music.');
      return [{block,scene:{...scene},bars:parsed.score.bars}];
    });
    if(!this.sequence.length)throw new Error('Add your current phrase to a block first.');
    const found=this.sequence.findIndex(e=>e.block>=from);this.cursor=found<0?0:found;
    this.active=true;
  }
  nextBar():{block:number;scene:TimelineScene}|null {
    if(!this.active)return null;
    if(this.remaining>0){this.remaining--;return null;}
    const entry=this.sequence[this.cursor]!;
    this.block=entry.block;this.remaining=entry.bars-1;
    this.cursor=(this.cursor+1)%this.sequence.length;
    return {block:entry.block,scene:{...entry.scene}};
  }
  stop():void{this.active=false;this.block=null;this.remaining=0;}
}
