#!/usr/bin/env node
/** Local AI Video Studio HTTP server. Node built-ins only; uploads stay local. */
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {promises as fs, createReadStream} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createVideo, type PipelineEvent} from '../engine/pipeline';
import type {Brief} from '../engine/planner/local';
import type {Ratio} from '../engine/types';
import {PROJECTS_DIR} from '../engine/project/manager';

const ROOT = process.cwd();
const PORT = Number(process.env.STUDIO_PORT || 4177);
const MAX_UPLOAD = 1024 * 1024 * 1024;
interface Job {id: string; status: 'queued'|'running'|'done'|'error'; events: PipelineEvent[]; result?: {projectId:string; projectDir:string; final?:string; storyboard?:string; qc?:string}; error?:string}
const jobs = new Map<string, Job>();

const send = (res: ServerResponse, status: number, body: string, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, {'Content-Type': type, 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store'});
  res.end(body);
};
const json = (res: ServerResponse, status: number, body: unknown) => send(res,status,JSON.stringify(body), 'application/json; charset=utf-8');
const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = []; let total = 0;
  for await (const c of req) { const b = Buffer.from(c); total += b.length; if (total > MAX_UPLOAD) throw new Error('Upload exceeds 1 GB limit'); chunks.push(b); }
  return Buffer.concat(chunks);
};

/** Minimal multipart/form-data parser preserving file bytes and bounding upload size. */
function multipart(body: Buffer, contentType: string): {fields: Record<string,string>; files: Array<{name:string; filename:string; data:Buffer}>} {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType)?.slice(1).find(Boolean);
  if (!boundary) throw new Error('Expected multipart/form-data');
  const marker = Buffer.from(`--${boundary}`); const fields: Record<string,string> = {}; const files: Array<{name:string;filename:string;data:Buffer}> = [];
  let cursor = 0;
  while (true) {
    const start = body.indexOf(marker, cursor); if (start < 0) break;
    let partStart = start + marker.length;
    if (body.subarray(partStart,partStart+2).toString() === '--') break;
    if (body.subarray(partStart,partStart+2).toString() === '\r\n') partStart += 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'),partStart); if (headerEnd < 0) break;
    const header = body.subarray(partStart,headerEnd).toString('utf8');
    const next = body.indexOf(marker,headerEnd+4); if (next < 0) break;
    let end = next; if (body.subarray(end-2,end).toString() === '\r\n') end -= 2;
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(header)?.[1] ?? '';
    const name = /name="([^"]+)"/.exec(disposition)?.[1]; const filename = /filename="([^"]*)"/.exec(disposition)?.[1];
    if (name) {
      const data = body.subarray(headerEnd+4,end);
      if (filename) { if (filename) files.push({name,filename:path.basename(filename),data:Buffer.from(data)}); }
      else fields[name] = data.toString('utf8');
    }
    cursor = next;
  }
  return {fields,files};
}
const safeName = (s:string) => path.basename(s).replace(/[^\p{L}\p{N}._-]+/gu,'_').slice(0,120) || `upload-${randomUUID()}`;

const route = async (req:IncomingMessage,res:ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/') {
    const html = await fs.readFile(path.join(ROOT,'studio','index.html'),'utf8'); return send(res,200,html,'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
    const job = jobs.get(url.pathname.split('/').pop()!); return job ? json(res,200,job) : json(res,404,{error:'Job not found'});
  }
  if (req.method === 'GET' && url.pathname === '/api/projects') {
    const entries = await fs.readdir(PROJECTS_DIR,{withFileTypes:true}).catch(()=>[]);
    const projects = await Promise.all(entries.filter(e=>e.isDirectory()).map(async e=>{
      const dir=path.join(PROJECTS_DIR,e.name); const state=JSON.parse(await fs.readFile(path.join(dir,'PROJECT_STATE.json'),'utf8').catch(()=> '{}'));
      return {id:e.name,name:state.name??e.name,style:state.style,ratio:state.format?.ratio,video:`/api/projects/${encodeURIComponent(e.name)}/video`,storyboard:`/api/projects/${encodeURIComponent(e.name)}/storyboard`};
    })); return json(res,200,projects);
  }
  const projectMatch = /^\/api\/projects\/([^/]+)\/(video|storyboard)$/.exec(url.pathname);
  if (req.method === 'GET' && projectMatch) {
    const id=decodeURIComponent(projectMatch[1]); const dir=path.resolve(PROJECTS_DIR,id);
    if (!dir.startsWith(path.resolve(PROJECTS_DIR)+path.sep)) return json(res,400,{error:'Invalid project'});
    const target = projectMatch[2] === 'video' ? path.join(dir,'output','final.mp4') : path.join(dir,'storyboard.md');
    try { const stat=await fs.stat(target); if (projectMatch[2]==='video') {res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':stat.size,'Accept-Ranges':'bytes'}); createReadStream(target).pipe(res);} else send(res,200,await fs.readFile(target,'utf8'),'text/markdown; charset=utf-8'); } catch {json(res,404,{error:'Output not available'});} return;
  }
  if (req.method === 'POST' && url.pathname === '/api/create') {
    try {
      const body=await readBody(req); const {fields,files}=multipart(body,req.headers['content-type']??'');
      const prompt=(fields.prompt??'').trim(); if (!prompt && !files.length) return json(res,400,{error:'Enter a prompt or upload material.'});
      const id=randomUUID(); const uploadDir=path.join(ROOT,'input','studio',id); await fs.mkdir(uploadDir,{recursive:true});
      const inputs:string[]=[];
      let referencePath:string|undefined;
      for (const file of files) {
        const dest=path.join(uploadDir,safeName(file.filename));
        await fs.writeFile(dest,file.data,{flag:'wx'});
        if (file.name === 'reference') referencePath=dest; else inputs.push(dest);
      }
      const ratio = (['16:9','9:16','1:1','4:5'].includes(fields.ratio) ? fields.ratio : '16:9') as Ratio;
      const brief:Brief={prompt,ratio,style:fields.style||undefined,duration:fields.duration?Number(fields.duration):undefined,title:fields.title||undefined,music:fields.music!=='false',captions:fields.captions!=='false',referencePath};
      const job:Job={id,status:'queued',events:[]}; jobs.set(id,job); json(res,202,{id});
      job.status='running';
      void createVideo({name:fields.name||undefined,inputs,brief,render:true,onEvent:(event)=>job.events.push(event)})
        .then(result=>{job.status='done';job.result={projectId:result.projectId,projectDir:result.projectDir,final:result.outputs.final,storyboard:result.outputs.storyboard,qc:result.qc?.level};})
        .catch(error=>{job.status='error';job.error=String(error?.message??error);});
      return;
    } catch(error) { return json(res,400,{error:String((error as Error).message)}); }
  }
  return json(res,404,{error:'Not found'});
};

createServer((req,res)=>{void route(req,res).catch(e=>{if(!res.headersSent)json(res,500,{error:String((e as Error).message)});else res.destroy();});})
  .listen(PORT,'127.0.0.1',()=>console.log(`Video Studio ready: http://127.0.0.1:${PORT}`));
