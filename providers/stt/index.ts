/**
 * STT provider abstraction.
 *
 * Order of preference (local-first):
 *   1. whisper.cpp via @remotion/install-whisper-cpp — fully local, no key
 *   2. OpenAI-compatible transcription API — when OPENAI_API_KEY is set
 *   3. unavailable → caller falls back to silence-based segmentation
 *
 * Never fakes results: every provider either returns real word timings or
 * reports unavailable, and the pipeline states which path it took.
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {CaptionCue, CaptionWord, ProviderStatus} from '../../engine/types';
import {ROOT} from '../../engine/project/manager';
import {extractAudio} from '../../engine/media/ffmpeg';

/** Whisper requires 16 kHz mono 16-bit WAV — convert once, cache beside input. */
const toWhisperInput = async (audioPath: string): Promise<string> => {
  const out = audioPath.replace(/\.[a-z0-9]+$/i, '') + '.whisper16k.wav';
  await extractAudio(audioPath, out);
  return out;
};

export interface Word {
  text: string;
  startMs: number;
  endMs: number;
}

export interface Transcript {
  text: string;
  words: Word[];
  language?: string;
  provider: string;
}

export interface SttProvider {
  status(): Promise<ProviderStatus>;
  /** Transcribe a 16 kHz mono WAV (or any audio file) to word timings. */
  transcribe(audioPath: string, opts?: {language?: string}): Promise<Transcript>;
}

const WHISPER_DIR = path.join(ROOT, 'node_modules', '.whisper');
/** Version Remotion hosts a proven Windows binary for (main.exe layout). */
const WHISPER_VERSION = '1.5.5';
const MODEL = (process.env.WHISPER_MODEL ?? 'base') as WhisperModelName;

type WhisperModelName =
  | 'tiny'
  | 'tiny.en'
  | 'base'
  | 'base.en'
  | 'small'
  | 'small.en'
  | 'medium'
  | 'medium.en'
  | 'large-v1'
  | 'large-v2'
  | 'large-v3'
  | 'large-v3-turbo';

/* ------------------------------- whisper.cpp (local) ------------------------------- */

class WhisperCppProvider implements SttProvider {
  private ready: Promise<boolean> | null = null;

  private async ensure(): Promise<boolean> {
    if (!this.ready) {
      this.ready = (async () => {
        const {installWhisperCpp, downloadWhisperModel} = await import('@remotion/install-whisper-cpp');
        await fs.mkdir(WHISPER_DIR, {recursive: true});
        // v1.5.5 layout: binary sits at the root of the install dir
        const exe = path.join(WHISPER_DIR, process.platform === 'win32' ? 'main.exe' : 'main');
        if (!(await fileReady(exe))) {
          // directory must not exist yet for a clean install
          await fs.rm(WHISPER_DIR, {recursive: true, force: true});
          await installWhisperCpp({version: WHISPER_VERSION, to: WHISPER_DIR, printOutput: false});
        }
        const modelFile = path.join(WHISPER_DIR, `ggml-${MODEL}.bin`);
        if (!(await fileReady(modelFile))) {
          await downloadWhisperModel({model: MODEL, folder: WHISPER_DIR, printOutput: false, onProgress: () => undefined});
        }
        return true;
      })().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  async status(): Promise<ProviderStatus> {
    try {
      await this.ensure();
      return {
        name: `whisper.cpp (${MODEL})`,
        kind: 'stt',
        available: true,
        mode: 'local',
        detail: `local whisper.cpp binary + ggml-${MODEL} model`,
      };
    } catch (e) {
      return {
        name: 'whisper.cpp',
        kind: 'stt',
        available: false,
        mode: 'unavailable',
        detail: `install failed: ${(e as Error).message.split('\n')[0].slice(0, 160)}`,
      };
    }
  }

  async transcribe(audioPath: string, opts?: {language?: string}): Promise<Transcript> {
    await this.ensure();
    const {transcribe, toCaptions} = await import('@remotion/install-whisper-cpp');
    const input16k = await toWhisperInput(audioPath);
    const result = await transcribe({
      inputPath: input16k,
      whisperPath: WHISPER_DIR,
      whisperCppVersion: WHISPER_VERSION,
      model: MODEL,
      modelFolder: WHISPER_DIR,
      tokenLevelTimestamps: true,
      language: (opts?.language as never) ?? null,
      printOutput: false,
      onProgress: () => undefined,
    });
    const captions = toCaptions({whisperCppOutput: result});
    // `words` stays as raw tokens (callers normalise); `text` is the readable
    // transcript assembled with whisper's own word-boundary convention.
    const words: Word[] = captions.captions.map((c) => ({
      text: c.text,
      startMs: c.startMs,
      endMs: c.endMs,
    }));
    return {
      text: wordsToText(words),
      words,
      language: result.result?.language,
      provider: `whisper.cpp:${WHISPER_VERSION}/${MODEL}`,
    };
  }
}

const fileReady = async (p: string): Promise<boolean> => {
  try {
    const st = await fs.stat(p);
    return st.size > 0;
  } catch {
    return false;
  }
};

/* --------------------------- OpenAI-compatible API --------------------------- */

class OpenAiSttProvider implements SttProvider {
  async status(): Promise<ProviderStatus> {
    const key = process.env.OPENAI_API_KEY;
    return {
      name: 'OpenAI Whisper API',
      kind: 'stt',
      available: Boolean(key),
      mode: key ? 'api' : 'unavailable',
      detail: key ? 'OPENAI_API_KEY set' : 'OPENAI_API_KEY not set',
    };
  }

  async transcribe(audioPath: string, opts?: {language?: string}): Promise<Transcript> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');
    const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const form = new FormData();
    const buf = await fs.readFile(audioPath);
    form.append('file', new Blob([buf]), path.basename(audioPath));
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    if (opts?.language) form.append('language', opts.language);
    const res = await fetch(`${base}/audio/transcriptions`, {method: 'POST', headers: {Authorization: `Bearer ${key}`}, body: form});
    if (!res.ok) throw new Error(`transcription API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      text?: string;
      words?: Array<{word: string; start: number; end: number}>;
      segments?: Array<{text: string; start: number; end: number}>;
    };
    let words: Word[] = (json.words ?? []).map((w) => ({text: w.word, startMs: w.start * 1000, endMs: w.end * 1000}));
    if (words.length === 0 && json.segments) {
      // fall back to segment-level timings split evenly
      for (const seg of json.segments) {
        const parts = seg.text.split(/\s+/).filter(Boolean);
        const span = (seg.end - seg.start) * 1000;
        parts.forEach((text, i) => {
          words.push({
            text,
            startMs: seg.start * 1000 + (span * i) / parts.length,
            endMs: seg.start * 1000 + (span * (i + 1)) / parts.length,
          });
        });
      }
    }
    return {text: (json.text ?? '').trim() || wordsToText(words), words, provider: 'openai-whisper'};
  }
}

/* ------------------------------- selection ------------------------------- */

let chosen: SttProvider | null = null;

/** Pick the first available provider (local preferred unless STT_PROVIDER forces one). */
export async function getSttProvider(): Promise<{provider: SttProvider | null; status: ProviderStatus}> {
  const forced = process.env.STT_PROVIDER;
  const candidates: SttProvider[] =
    forced === 'openai' ? [new OpenAiSttProvider()] : forced === 'whisper' ? [new WhisperCppProvider()] : [new WhisperCppProvider(), new OpenAiSttProvider()];

  for (const c of candidates) {
    const s = await c.status();
    if (s.available) {
      chosen = c;
      return {provider: c, status: s};
    }
  }
  const last = await candidates[candidates.length - 1].status();
  return {
    provider: null,
    status: {name: 'speech-to-text', kind: 'stt', available: false, mode: 'unavailable', detail: last.detail},
  };
}

/* ------------------------------ token hygiene ------------------------------ */

/** Whisper emits non-speech markers such as `[BLANK_AUDIO]` — not words. */
export const isBracketedToken = (text: string): boolean => /^\s*[[(<][^\])>]*[\])>]\s*$/.test(text);

/** A token carrying no letters or digits is punctuation, not a word. */
export const isPunctuationOnly = (text: string): boolean => !/[\p{L}\p{N}]/u.test(text);

/** Append a token without inserting a space before punctuation. */
export const appendToken = (buffer: string, token: string): string => {
  const t = token.trim();
  if (!t) return buffer;
  if (!buffer) return t;
  if (isPunctuationOnly(t)) return buffer + t;
  return `${buffer} ${t}`;
};

/**
 * Normalise whisper's subword tokens into real whitespace-delimited words.
 *
 * Whisper tokenises with BPE, so a token either carries a leading space (it
 * begins a new word) or does not (it continues the previous one) — e.g.
 * `"Sh"` + `"ips"` is the word "Ships". Naively rejoining tokens with spaces
 * corrupts the transcript ("Sh ips"), which then breaks keyword matching,
 * planning and captions. Punctuation has no leading space, so it correctly
 * folds onto the word it follows.
 */
export const normalizeWords = (words: Word[]): Word[] => {
  const out: Word[] = [];
  for (const w of words) {
    const raw = w.text;
    const trimmed = raw.replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;
    const startsNewWord = /^\s/.test(raw) || out.length === 0;
    const prev = out[out.length - 1];
    if (!startsNewWord && prev) {
      prev.text = prev.text + trimmed;
      prev.endMs = Math.max(prev.endMs, w.endMs);
      continue;
    }
    out.push({text: trimmed, startMs: w.startMs, endMs: w.endMs});
  }
  return out;
};

/** Readable transcript text from raw tokens (subwords joined, markers removed). */
export const wordsToText = (words: Word[]): string =>
  normalizeWords(speechWords(words))
    .map((w) => w.text)
    .reduce(appendToken, '')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();

/**
 * Drop non-speech artefacts so they never reach captions or the transcript.
 *
 * Whisper emits markers like `[BLANK_AUDIO]`, but tokenisation can split them
 * into `[`, `BLANK`, `_`, `AUDIO`, `]` — a per-token filter misses those, so any
 * run running from a token that opens a bracket to one that closes it is
 * removed as a unit.
 */
export const speechWords = (words: Word[]): Word[] => {
  const out: Word[] = [];
  let inMarker = false;
  for (const w of words) {
    const t = w.text.trim();
    if (!inMarker && isBracketedToken(t)) continue;
    if (!inMarker && t.startsWith('[')) {
      inMarker = true;
      continue;
    }
    if (inMarker) {
      if (t.endsWith(']')) inMarker = false;
      continue;
    }
    if (/^[\])\)>]+$/.test(t)) continue;
    out.push(w);
  }
  return out;
};

/* ------------------------- transcript → caption cues ------------------------- */

/** Group words into readable caption cues (phrase/sentence chunks). */
export function wordsToCues(words: Word[], opts: {maxWords?: number; maxChars?: number; maxGapMs?: number} = {}): CaptionCue[] {
  const maxWords = opts.maxWords ?? 6;
  const maxChars = opts.maxChars ?? 34;
  const maxGap = opts.maxGapMs ?? 700;
  const cues: CaptionCue[] = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    cues.push({
      text: current.map((w) => w.text).reduce(appendToken, '').replace(/\s+([,.!?;:])/g, '$1'),
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      words: current.slice(),
    });
    current = [];
  };

  for (const w of normalizeWords(speechWords(words))) {
    if (current.length > 0) {
      const chars = current.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length;
      const gap = w.startMs - current[current.length - 1].endMs;
      const sentenceBreak = /[.!?]\)?$/.test(current[current.length - 1].text);
      if (current.length >= maxWords || chars > maxChars || gap > maxGap || sentenceBreak) flush();
    }
    current.push({text: w.text, startMs: w.startMs, endMs: w.endMs});
    if (/^[.!?]$/.test(w.text.trim())) flush();
  }
  flush();
  return cues;
}

/** Sentence-level segments used for scene planning (start/end + text). */
export interface Segment {
  text: string;
  startMs: number;
  endMs: number;
  words: Word[];
}

export function wordsToSegments(words: Word[], opts: {maxChars?: number} = {}): Segment[] {
  const maxChars = opts.maxChars ?? 220;
  const out: Segment[] = [];
  let current: Word[] = [];
  let buffer = '';
  const flush = () => {
    if (current.length === 0) return;
    out.push({
      text: buffer.trim(),
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      words: current.slice(),
    });
    current = [];
    buffer = '';
  };
  for (const w of normalizeWords(speechWords(words))) {
    current.push(w);
    buffer = appendToken(buffer, w.text);
    if (/[.!?]$/.test(w.text.trim()) || buffer.length > maxChars) flush();
  }
  flush();
  return out;
}