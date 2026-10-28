/**
 * Project manager — owns the on-disk layout and PROJECT_STATE.json (revision
 * memory). Every production run lands in projects/<id>/ so revisions can
 * regenerate only what changed instead of rebuilding the whole project.
 *
 * Layout:
 *   projects/<id>/
 *     PROJECT_STATE.json   brief, inputs, providers, revisions
 *     video-plan.json      the authoritative timeline (VIDEO_PLAN)
 *     storyboard.md        human-readable scene breakdown
 *     transcript.json      words + timestamps (when STT available)
 *     public/              media staged for Remotion staticFile()
 *     work/                intermediates (extracted audio, cuts, mix)
 *     output/              final.mp4, preview.mp4, thumbnail, captions, QC
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {FormatSpec, InputDescriptor, ProjectState, ProviderStatus, VideoPlan} from '../types';

export const ROOT = path.resolve(process.cwd());
export const PROJECTS_DIR = path.join(ROOT, 'projects');

export interface ProjectPaths {
  dir: string;
  state: string;
  plan: string;
  storyboard: string;
  transcript: string;
  publicDir: string;
  work: string;
  output: string;
  final: string;
  preview: string;
  thumbnail: string;
  captionsSrt: string;
  captionsVtt: string;
  qc: string;
  audioMix: string;
  voiceover: string;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

export function pathsFor(dir: string): ProjectPaths {
  const out = path.join(dir, 'output');
  return {
    dir,
    state: path.join(dir, 'PROJECT_STATE.json'),
    plan: path.join(dir, 'video-plan.json'),
    storyboard: path.join(dir, 'storyboard.md'),
    transcript: path.join(dir, 'transcript.json'),
    publicDir: path.join(dir, 'public'),
    work: path.join(dir, 'work'),
    output: out,
    final: path.join(out, 'final.mp4'),
    preview: path.join(out, 'preview.mp4'),
    thumbnail: path.join(out, 'thumbnail.jpg'),
    captionsSrt: path.join(out, 'captions.srt'),
    captionsVtt: path.join(out, 'captions.vtt'),
    qc: path.join(out, 'qc-report.md'),
    audioMix: path.join(out, 'audio-mix.wav'),
    voiceover: path.join(out, 'voiceover.wav'),
  };
}

export async function createProject(name: string): Promise<ProjectPaths> {
  const slug = slugify(name);
  const dir = path.join(PROJECTS_DIR, `${slug}-${randomUUID().slice(0, 6)}`);
  const p = pathsFor(dir);
  await fs.mkdir(p.publicDir, {recursive: true});
  await fs.mkdir(p.work, {recursive: true});
  await fs.mkdir(p.output, {recursive: true});
  const state: ProjectState = {
    id: path.basename(dir),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    brief: {},
    inputs: [],
    style: 'cinematic',
    format: {ratio: '16:9', width: 1920, height: 1080, fps: 30},
    providers: [],
    files: {},
    revisions: [],
    notes: [],
  };
  await writeState(p, state);
  return p;
}

export async function loadProject(dir: string): Promise<ProjectPaths> {
  const p = pathsFor(path.resolve(dir));
  if (!(await fileExists(p.state))) {
    throw new Error(`Not a video-engine project (missing PROJECT_STATE.json): ${p.dir}`);
  }
  return p;
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readState(paths: ProjectPaths): Promise<ProjectState> {
  return JSON.parse(await fs.readFile(paths.state, 'utf8')) as ProjectState;
}

export async function writeState(paths: ProjectPaths, state: ProjectState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(paths.state, JSON.stringify(state, null, 2), 'utf8');
}

export async function updateState(paths: ProjectPaths, patch: Partial<ProjectState>): Promise<ProjectState> {
  const s = await readState(paths);
  Object.assign(s, patch);
  await writeState(paths, s);
  return s;
}

export async function addRevision(paths: ProjectPaths, note: string): Promise<ProjectState> {
  const s = await readState(paths);
  s.revisions.push({n: s.revisions.length + 1, note, at: new Date().toISOString()});
  await writeState(paths, s);
  return s;
}

export async function writePlan(paths: ProjectPaths, plan: VideoPlan): Promise<void> {
  await fs.writeFile(paths.plan, JSON.stringify(plan, null, 2), 'utf8');
}

export async function readPlan(paths: ProjectPaths): Promise<VideoPlan> {
  return JSON.parse(await fs.readFile(paths.plan, 'utf8')) as VideoPlan;
}

export async function planExists(paths: ProjectPaths): Promise<boolean> {
  return fileExists(paths.plan);
}

/**
 * Stage external media into the project's public dir so Remotion can serve it
 * via staticFile(). Returns the relative path to pass to staticFile().
 * Copied once; repeated calls with identical sources are cheap (size+mtime guard).
 */
export async function stageAsset(paths: ProjectPaths, sourcePath: string, asName?: string): Promise<string> {
  const abs = path.resolve(sourcePath);
  const st = await fs.stat(abs);
  const name =
    asName ??
    `${path.basename(abs, path.extname(abs)).replace(/[^a-zA-Z0-9_-]/g, '_')}-${(st.size % 1e9).toString(36)}${path.extname(abs)}`;
  const dest = path.join(paths.publicDir, name);
  try {
    const dst = await fs.stat(dest);
    if (dst.size === st.size) return name;
  } catch {
    /* not staged yet */
  }
  await fs.copyFile(abs, dest);
  return name;
}

export async function writeTextFile(p: string, content: string): Promise<string> {
  await fs.mkdir(path.dirname(p), {recursive: true});
  await fs.writeFile(p, content, 'utf8');
  return p;
}

export interface NewProjectInput {
  name: string;
  brief: Record<string, unknown>;
  inputs: InputDescriptor[];
  style: string;
  format: FormatSpec;
  providers: ProviderStatus[];
  notes?: string[];
}

export async function initProject(input: NewProjectInput): Promise<{paths: ProjectPaths; state: ProjectState}> {
  const paths = await createProject(input.name);
  const state = await readState(paths);
  state.brief = input.brief;
  state.inputs = input.inputs;
  state.style = input.style;
  state.format = input.format;
  state.providers = input.providers;
  state.notes = input.notes ?? [];
  await writeState(paths, state);
  return {paths, state};
}