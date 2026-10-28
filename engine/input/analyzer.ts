/**
 * Input analyzer — MODE A..G detection.
 *
 * Classifies whatever the user hands us (video / audio / images / script /
 * references / prompt-only) into normalized InputDescriptors that the planner
 * consumes to pick a production mode.
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {probe, MediaError} from '../media/ffmpeg';
import type {InputDescriptor} from '../types';

const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.mpg', '.mpeg', '.wmv']);
const AUDIO_EXT = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma', '.aiff']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.tif', '.tiff']);
const TEXT_EXT = new Set(['.txt', '.md', '.srt', '.vtt', '.json', '.csv']);

export type InputMode =
  | 'video+audio' // MODE A
  | 'video-only' // MODE B
  | 'audio-only' // MODE C
  | 'script-only' // MODE D
  | 'prompt-only' // MODE E
  | 'images+script' // MODE F
  | 'mixed'; // MODE G

export interface AnalysisResult {
  inputs: InputDescriptor[];
  mode: InputMode;
  /**
   * Narratable content taken from supplied TEXT FILES only.
   * Deliberately excludes the prompt: a prompt is an instruction about the
   * output, not a script. Conflating the two makes an audio-plus-prompt job look
   * like a scripted one and silently discards the narration.
   */
  text?: string;
  /** the user's free-text brief (what they want, not what is spoken) */
  prompt?: string;
  hasVideo: boolean;
  hasAudioMedia: boolean;
  hasImages: boolean;
  /** true when there is any script text (a text file, or a prompt standing in for one) */
  hasScript: boolean;
  /** true when a text file supplied actual script content */
  hasScriptFile: boolean;
  totalDuration: number;
}

async function statKind(file: string): Promise<'video' | 'audio' | 'image' | 'text' | 'unknown'> {
  const ext = path.extname(file).toLowerCase();
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'unknown';
}

export async function describeFile(file: string): Promise<InputDescriptor> {
  const abs = path.resolve(file);
  const st = await fs.stat(abs);
  const kindByExt = await statKind(abs);
  const base: InputDescriptor = {
    path: abs,
    kind: kindByExt,
    hasAudio: false,
    hasVideo: false,
    sizeBytes: st.size,
  };
  if (kindByExt === 'text') {
    return base;
  }
  if (kindByExt === 'unknown') {
    // Try probing — containers sometimes carry odd extensions
    try {
      const p = await probe(abs);
      return {
        ...base,
        kind: p.hasVideo ? 'video' : p.hasAudio ? 'audio' : 'unknown',
        duration: p.duration,
        width: p.width,
        height: p.height,
        hasAudio: p.hasAudio,
        hasVideo: p.hasVideo,
        detail: `${p.codecV ?? ''}${p.codecV && p.codecA ? '+' : ''}${p.codecA ?? ''}`.trim(),
      };
    } catch (e) {
      return {...base, detail: `unrecognized: ${(e as Error).message.split('\n')[0]}`};
    }
  }
  try {
    const p = await probe(abs);
    return {
      ...base,
      duration: p.duration,
      width: p.width,
      height: p.height,
      hasAudio: p.hasAudio,
      hasVideo: p.hasVideo,
      detail: `${p.codecV ?? ''}${p.codecV && p.codecA ? '+' : ''}${p.codecA ?? ''}${p.fps ? ` @${p.fps.toFixed(2)}fps` : ''}`.trim(),
    };
  } catch (e) {
    const msg = e instanceof MediaError ? e.stderr.split('\n').slice(-3).join(' ') : (e as Error).message;
    return {...base, detail: `probe failed: ${msg.slice(0, 200)}`};
  }
}

export async function analyzeInputs(files: string[], promptText?: string): Promise<AnalysisResult> {
  const inputs: InputDescriptor[] = [];
  const scriptParts: string[] = [];
  for (const f of files) {
    const d = await describeFile(f);
    inputs.push(d);
    if (d.kind === 'text') {
      try {
        scriptParts.push(await fs.readFile(d.path, 'utf8'));
      } catch {
        /* unreadable text file — ignore */
      }
    }
  }

  const hasVideo = inputs.some((i) => i.kind === 'video' && i.hasVideo);
  const hasAudioMedia = inputs.some((i) => i.kind === 'audio' || (i.kind === 'video' && i.hasAudio));
  const hasImages = inputs.some((i) => i.kind === 'image');
  const text = scriptParts.join('\n\n').trim();
  const prompt = (promptText ?? '').trim();
  const hasScriptFile = text.length > 0;
  const hasPrompt = prompt.length > 0;
  const totalDuration = inputs.reduce((acc, i) => Math.max(acc, i.duration ?? 0), 0);

  // Mode is decided by the *material*, not by whether a brief was supplied.
  // The spine of the edit is, in priority order: spoken footage, silent
  // footage, narration audio, supplied stills, then text alone.
  // Text files are the script, not media: a script on its own is 'script-only',
  // not 'mixed'.
  const mediaInputs = inputs.filter((i) => i.kind !== 'text');
  let mode: InputMode;
  if (hasVideo) mode = hasAudioMedia ? 'video+audio' : 'video-only';
  else if (hasAudioMedia && !hasImages) mode = 'audio-only';
  else if (hasImages && (hasScriptFile || hasPrompt)) mode = 'images+script';
  else if (mediaInputs.length === 0 && hasScriptFile) mode = 'script-only';
  else if (mediaInputs.length === 0) mode = 'prompt-only';
  else mode = 'mixed';

  return {
    inputs,
    mode,
    text: hasScriptFile ? text : undefined,
    prompt: hasPrompt ? prompt : undefined,
    hasVideo,
    hasAudioMedia,
    hasImages,
    hasScript: hasScriptFile || hasPrompt,
    hasScriptFile,
    totalDuration,
  };
}

/** Collect files from a directory (non-recursive, common media types). */
export async function collectInputs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, {withFileTypes: true});
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (VIDEO_EXT.has(ext) || AUDIO_EXT.has(ext) || IMAGE_EXT.has(ext) || TEXT_EXT.has(ext)) {
      out.push(path.join(dir, e.name));
    }
  }
  return out.sort();
}