/**
 * Music + sound-design provider.
 *
 * Two real paths, no placeholders:
 *
 *   1. LOCAL SYNTHESIS (always available, offline, deterministic)
 *      `synthesizeBed()` builds a music bed from a chord progression using
 *      FFmpeg's `sine` sources — mood-mapped progressions, stereo widening,
 *      reverb tail, loudness-normalised, exact duration.
 *      `synthesizeSfx()` builds whoosh / riser / impact / click / swell
 *      effects from real synthesis (noise bursts, frequency sweeps, decaying
 *      low tones) — the sound-design layer.
 *
 *   2. STOCK MUSIC API (optional) — Jamendo (JAMENDO_CLIENT_ID) for licensed
 *      music search + download. Reported unavailable when no key is set.
 *
 * Synthesised beds are simple tonal ambience, not licensed songs: the planner
 * labels them as such so nobody mistakes them for a real soundtrack.
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {ffmpeg, ffprobe} from '../../engine/media/ffmpeg';
import type {ProviderStatus} from '../../engine/types';

export type MusicMood = 'calm' | 'tense' | 'upbeat' | 'serious' | 'wonder' | 'sad';

export interface MusicBedOptions {
  durationSec: number;
  mood: MusicMood;
  output: string;
  /** base gain 0..1 (default 0.32 — bed sits under narration) */
  gain?: number;
  /** seed shifts the progression rotation */
  seed?: number;
}

export type SfxKind = 'whoosh' | 'riser' | 'impact' | 'click' | 'swell';

/* ------------------------------ theory tables ------------------------------ */

/** semitone offsets from the root, four chords per mood */
const PROGRESSIONS: Record<MusicMood, number[][]> = {
  calm: [[0, 7, 12, 16], [-4, 3, 8, 12], [-7, 0, 5, 12], [-5, 2, 7, 11]],
  wonder: [[0, 7, 12, 19], [-5, 2, 7, 14], [-3, 4, 9, 16], [0, 7, 12, 16]],
  tense: [[0, 3, 7, 10], [0, 3, 6, 10], [-2, 1, 5, 8], [0, 3, 7, 10]],
  upbeat: [[0, 4, 7, 12], [-3, 2, 5, 12], [-5, 0, 4, 11], [0, 4, 7, 12]],
  serious: [[0, 5, 7, 12], [-2, 3, 7, 10], [-4, 0, 5, 9], [0, 5, 7, 12]],
  sad: [[0, 3, 7, 12], [-4, 0, 3, 10], [-5, -1, 2, 7], [-7, -3, 0, 5]],
};

/** root MIDI note per mood (lower = heavier) */
const ROOTS: Record<MusicMood, number> = {calm: 45, wonder: 45, tense: 38, upbeat: 48, serious: 43, sad: 41};

/** tremolo rate (Hz) and depth per mood — 2 Hz ≈ 120 BPM pulse */
const PULSE: Record<MusicMood, {f: number; d: number}> = {
  calm: {f: 0.35, d: 0.12},
  wonder: {f: 0.5, d: 0.15},
  tense: {f: 1.1, d: 0.3},
  upbeat: {f: 2.0, d: 0.45},
  serious: {f: 0.6, d: 0.18},
  sad: {f: 0.25, d: 0.1},
};

const midiToFreq = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

/* ---------------------------- local music synthesis ---------------------------- */

const runFfmpeg = (args: string[], timeoutMs = 180_000) => ffmpeg(args, {quiet: true, timeoutMs});

/** Render one chord segment as a stereo WAV. */
const renderChord = async (
  freqs: number[],
  segSec: number,
  mood: MusicMood,
  output: string,
): Promise<string> => {
  const inputs: string[] = [];
  for (const f of freqs) {
    inputs.push('-f', 'lavfi', '-i', `sine=f=${f.toFixed(2)}:d=${segSec.toFixed(3)}:sample_rate=48000`);
  }
  const pulse = PULSE[mood];
  const chain = [
    `${freqs.map((_, i) => `[${i}:a]`).join('')}amix=inputs=${freqs.length}:duration=longest:normalize=0`,
    // gentle low-pass keeps the sines from sounding harsh
    'lowpass=f=4200',
    // slow amplitude movement so the pad breathes
    `tremolo=f=${pulse.f}:d=${pulse.d}`,
    // widen: duplicate, delay one side slightly, merge to stereo
    'asplit=2[w1][w2]',
  ];
  const graph =
    chain.join(',') +
    ';' +
    `[w1]anull[l];[w2]adelay=17:all=1[r];[l][r]amerge=inputs=2,aformat=sample_fmts=fltp:channel_layouts=stereo[out]`;
  await runFfmpeg([
    ...inputs,
    '-filter_complex',
    graph,
    '-map',
    '[out]',
    '-ar',
    '48000',
    '-c:a',
    'pcm_s16le',
    output,
  ]);
  return output;
};

/**
 * Synthesize a music bed of exactly `durationSec`, mood-mapped.
 * Deterministic: same mood + duration ⇒ identical audio.
 */
export async function synthesizeBed(opts: MusicBedOptions): Promise<string> {
  const duration = Math.max(2, opts.durationSec);
  const mood = opts.mood;
  const gain = opts.gain ?? 0.32;
  const workDir = path.join(path.dirname(opts.output), 'music-work');
  await fs.mkdir(workDir, {recursive: true});

  const segSec = mood === 'upbeat' ? 4 : 6;
  const count = Math.max(1, Math.ceil(duration / segSec));
  const progression = PROGRESSIONS[mood];
  const root = ROOTS[mood];
  const rotation = (opts.seed ?? 0) % progression.length;

  const segments: string[] = [];
  for (let i = 0; i < count; i++) {
    const chord = progression[(i + rotation) % progression.length];
    // drop the top voice on the last chord for a settling cadence
    const voices = i === count - 1 && count > 2 ? chord.slice(0, 3) : chord;
    const freqs = voices.map((semi) => midiToFreq(root + semi));
    const segPath = path.join(workDir, `chord-${mood}-${i}.wav`);
    segments.push(await renderChord(freqs, segSec, mood, segPath));
  }

  const listFile = path.join(workDir, 'bed-concat.txt');
  await fs.writeFile(
    listFile,
    segments.map((s) => `file '${s.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n'),
    'utf8',
  );
  const raw = path.join(workDir, 'bed-raw.wav');
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', raw]);

  const fadeOutStart = Math.max(0.5, duration - 2.2);
  await runFfmpeg([
    '-i',
    raw,
    '-af',
    [
      `atrim=0:${duration.toFixed(3)}`,
      'asetpts=PTS-STARTPTS',
      `volume=${gain}`,
      `afade=t=in:st=0:d=1.6`,
      `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=2.2`,
      'loudnorm=I=-26:TP=-6:LRA=8',
    ].join(','),
    '-ar',
    '48000',
    '-c:a',
    'pcm_s16le',
    opts.output,
  ]);

  await fs.rm(workDir, {recursive: true, force: true}).catch(() => undefined);
  return opts.output;
}

/* ----------------------------- sound design (SFX) ----------------------------- */

interface SfxRecipe {
  dur: number;
  /** one entry per lavfi input source */
  sources: string[];
  /** filter_complex, must label its result [out] */
  graph: string;
}

const SFX_RECIPES: Record<SfxKind, SfxRecipe> = {
  // filtered noise sweep — motion / transition accent
  whoosh: {
    dur: 1.1,
    sources: ['anoisesrc=c=pink:a=0.35:d=1.1:sample_rate=48000'],
    graph:
      '[0:a]highpass=f=380,lowpass=f=2600,afade=t=in:d=0.4,afade=t=out:st=0.5:d=0.6,volume=0.6[out]',
  },
  // upward frequency sweep — builds tension into a reveal
  riser: {
    dur: 2.4,
    sources: [
      'aevalsrc=exprs=0.2*sin(2*PI*(180+520*t)*t):d=2.4:s=48000',
      'anoisesrc=c=pink:a=0.12:d=2.4:sample_rate=48000',
    ],
    graph:
      '[0:a]lowpass=f=5200[sweep];[1:a]highpass=f=700,lowpass=f=4200[air];' +
      '[sweep][air]amix=inputs=2:duration=longest:normalize=0,afade=t=in:d=1.1,afade=t=out:st=2.0:d=0.4,volume=0.75[out]',
  },
  // low decaying hit + noise transient — emphasis on a statement
  impact: {
    dur: 1.6,
    sources: [
      'aevalsrc=exprs=0.6*sin(2*PI*58*t)*exp(-3.2*t):d=1.6:s=48000',
      'anoisesrc=c=white:a=0.4:d=1.6:sample_rate=48000',
    ],
    graph:
      '[0:a]lowpass=f=620,volume=0.95[low];' +
      '[1:a]highpass=f=200,afade=t=out:st=0.005:d=0.22,volume=0.45[trans];' +
      '[low][trans]amix=inputs=2:duration=longest:normalize=0,volume=0.9[out]',
  },
  click: {
    dur: 0.09,
    sources: ['sine=f=1500:d=0.09:sample_rate=48000'],
    graph: '[0:a]afade=t=out:st=0.01:d=0.08,volume=0.4[out]',
  },
  // slow swell used to lift into a new act
  swell: {
    dur: 3.2,
    sources: ['aevalsrc=exprs=0.18*sin(2*PI*196*t):d=3.2:s=48000'],
    graph:
      '[0:a]tremolo=f=0.4:d=0.5,lowpass=f=3000,afade=t=in:d=2.1,afade=t=out:st=2.6:d=0.6,volume=0.7[out]',
  },
};

/** Synthesize one sound effect (real audio, offline, deterministic). */
export async function synthesizeSfx(kind: SfxKind, output: string): Promise<string> {
  const recipe = SFX_RECIPES[kind];
  await fs.mkdir(path.dirname(output), {recursive: true});
  await runFfmpeg([
    ...recipe.sources.flatMap((src) => ['-f', 'lavfi', '-i', src]),
    '-filter_complex',
    recipe.graph,
    '-map',
    '[out]',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    output,
  ]);
  return output;
}

/** Build the standard transition sound-design set once per project. */
export async function synthesizeSfxSet(dir: string): Promise<Record<SfxKind, string>> {
  const kinds: SfxKind[] = ['whoosh', 'riser', 'impact', 'click', 'swell'];
  const out = {} as Record<SfxKind, string>;
  for (const k of kinds) {
    out[k] = await synthesizeSfx(k, path.join(dir, `${k}.wav`));
  }
  return out;
}

/* ------------------------------- stock music API ------------------------------- */

export interface StockTrack {
  id: string;
  title: string;
  artist: string;
  url: string;
  durationSec?: number;
  license: string;
  pageUrl?: string;
}

/** Jamendo licensed-music search — requires JAMENDO_CLIENT_ID. */
export async function searchMusic(q: string, limit = 5): Promise<{tracks: StockTrack[]; error?: string}> {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) return {tracks: [], error: 'JAMENDO_CLIENT_ID not set'};
  const url = new URL('https://api.jamendo.com/v3.0/tracks/');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('search', q);
  url.searchParams.set('audioformat', 'mp32');
  url.searchParams.set('include', 'licenses');
  try {
    const res = await fetch(url);
    if (!res.ok) return {tracks: [], error: `Jamendo ${res.status}`};
    const json = (await res.json()) as {
      results?: Array<{id: string; name: string; artist_name: string; audio: string; duration: number; shareurl: string; license_ccurl?: string}>;
    };
    return {
      tracks: (json.results ?? []).map((t) => ({
        id: `jamendo-${t.id}`,
        title: t.name,
        artist: t.artist_name,
        url: t.audio,
        durationSec: t.duration,
        license: t.license_ccurl ?? 'Jamendo license',
        pageUrl: t.shareurl,
      })),
    };
  } catch (e) {
    return {tracks: [], error: (e as Error).message};
  }
}

/* -------------------------------- status -------------------------------- */

export interface MusicProviderStatus extends ProviderStatus {
  /** true when the bed is synthesised locally rather than licensed */
  synthetic?: boolean;
}

export function musicStatuses(): MusicProviderStatus[] {
  const jamendo = Boolean(process.env.JAMENDO_CLIENT_ID);
  return [
    {
      name: 'Local music synthesis (FFmpeg)',
      kind: 'music',
      available: true,
      mode: 'local',
      detail: 'offline chord-progression beds + synthesised SFX (no key, no network)',
      synthetic: true,
    },
    {
      name: 'Jamendo',
      kind: 'music',
      available: jamendo,
      mode: jamendo ? 'api' : 'unavailable',
      detail: jamendo ? 'JAMENDO_CLIENT_ID set' : 'JAMENDO_CLIENT_ID not set',
    },
  ];
}

/** Duration of any audio file in seconds (used to place synthesised beds). */
export async function audioDuration(file: string): Promise<number> {
  const out = await ffprobe(['-print_format', 'json', '-show_format', file]);
  const json = JSON.parse(out) as {format?: {duration?: string}};
  return Number(json.format?.duration ?? 0) || 0;
}
