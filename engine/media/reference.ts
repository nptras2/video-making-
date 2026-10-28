/** Reference-style analysis by measurable editing characteristics. */
import path from 'node:path';
import {ffmpeg, probe} from './ffmpeg';

export interface ReferenceSignature {
  file: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  aspect: 'vertical'|'square'|'landscape';
  sceneCutsSec: number[];
  averageShotSec: number;
  pacing: 'slow'|'measured'|'brisk'|'rapid';
  meanLuma?: number;
  sampledFrames: number;
  transitions: string[];
  originalityNote: string;
}

export async function analyzeReference(file: string): Promise<ReferenceSignature> {
  const meta=await probe(file);
  if(!meta.hasVideo||!meta.width||!meta.height) throw new Error(`Reference has no readable video stream: ${file}`);
  const duration=Math.max(0,meta.duration);
  const cutLog=await ffmpeg(['-i',file,'-vf','select=gt(scene\\,0.32),showinfo','-an','-f','null','-'],{quiet:false});
  const cuts=[...cutLog.matchAll(/pts_time:([0-9.]+)/g)].map(m=>Number(m[1])).filter(t=>t>0&&t<duration).sort((a,b)=>a-b);
  const unique=cuts.filter((t,i)=>i===0||t-cuts[i-1]>0.12);
  const avg=duration/(unique.length+1);
  const pacing:ReferenceSignature['pacing']=avg<1.2?'rapid':avg<2.7?'brisk':avg<5?'measured':'slow';
  let meanLuma:number|undefined;
  try {
    const lumaLog=await ffmpeg(['-i',file,'-vf','fps=1,signalstats,metadata=print:key=lavfi.signalstats.YAVG','-an','-f','null','-'],{quiet:false});
    const samples=[...lumaLog.matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g)].map(m=>Number(m[1]));
    if(samples.length) meanLuma=samples.reduce((a,b)=>a+b,0)/samples.length;
  } catch { /* scene-cut signature remains useful if signalstats is unavailable */ }
  const width=meta.width,height=meta.height;
  return {file:path.basename(file),durationSec:duration,width,height,fps:meta.fps??30,aspect:height/width>1.15?'vertical':width/height<1.15?'square':'landscape',sceneCutsSec:unique,averageShotSec:avg,pacing,meanLuma,sampledFrames:unique.length+1,transitions:unique.length>0?['frame-change cut points detected']:[],originalityNote:'Only measurable style statistics are extracted; reference frames, copy, and unique content are not reused.'};
}
