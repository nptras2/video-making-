/**
 * Deterministic media-processing layer built on FFmpeg/ffprobe.
 *
 * Remotion owns creative composition; everything here is exact media work:
 * probing, extracting, cutting, concatenating, reframing, mixing, thumbnails.
 * All operations are promise-based wrappers over spawn() with captured stderr,
 * so failures carry real diagnostics instead of silent drops.
 */
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

export class MediaError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.name = 'MediaError';
    this.stderr = stderr;
  }
}

interface RunResult {
  stdout: string;
  stderr: string;
}

async function run(bin: string, args: string[], opts: {timeoutMs?: number} = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {windowsHide: true});
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new MediaError(`${bin} timed out after ${opts.timeoutMs ?? 0}ms`, stderr));
    }, opts.timeoutMs ?? 10 * 60 * 1000);
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new MediaError(`Failed to start ${bin}: ${err.message}`, stderr));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({stdout, stderr});
      else reject(new MediaError(`${bin} exited with code ${code}\n  cmd: ${bin} ${args.join(' ')}`, stderr));
    });
  });
}

/**
 * Run ffmpeg and return its stderr log.
 *
 * ffmpeg writes everything useful (silencedetect, blackdetect, volumedetect,
 * progress) to stderr, so that is the documented return value — parsing callers
 * must never have to rely on a non-zero exit to see the log.
 * Use `ffmpegRaw` when stdout matters (e.g. `-f -` pipe output).
 */
export async function ffmpeg(args: string[], opts: {timeoutMs?: number; quiet?: boolean} = {}): Promise<string> {
  const full = ['-hide_banner', '-y', ...(opts.quiet ? ['-loglevel', 'error'] : []), ...args];
  const res = await run(FFMPEG, full, opts);
  return res.stderr;
}

/** Run ffmpeg and return both streams (for pipe output). */
export async function ffmpegRaw(args: string[], opts: {timeoutMs?: number} = {}): Promise<RunResult> {
  return run(FFMPEG, ['-hide_banner', '-y', ...args], opts);
}

export async function ffprobe(args: string[]): Promise<string> {
  const res = await run(FFPROBE, ['-v', 'error', ...args]);
  return res.stdout;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export interface ProbeResult {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  codecV?: string;
  codecA?: string;
  bitrate?: number;
}

export async function probe(file: string): Promise<ProbeResult> {
  const out = await ffprobe([
    '-print_format', 'json',
    '-show_format', '-show_streams',
    file,
  ]);
  const json = JSON.parse(out) as {
    streams?: Array<Record<string, unknown>>;
    format?: {duration?: string; bit_rate?: string};
  };
  const streams = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  let fps: number | undefined;
  if (v && typeof v.r_frame_rate === 'string' && v.r_frame_rate.includes('/')) {
    const [n, d] = v.r_frame_rate.split('/').map(Number);
    if (d > 0) fps = n / d;
  }
  const duration = Number(json.format?.duration ?? (v ? v.duration : 0)) || 0;
  return {
    duration,
    width: v ? Number(v.width) : undefined,
    height: v ? Number(v.height) : undefined,
    fps,
    hasVideo: Boolean(v),
    hasAudio: Boolean(a),
    codecV: v ? String(v.codec_name) : undefined,
    codecA: a ? String(a.codec_name) : undefined,
    bitrate: json.format?.bit_rate ? Number(json.format.bit_rate) : undefined,
  };
}

export async function getDuration(file: string): Promise<number> {
  const p = await probe(file);
  return p.duration;
}

/** Extract mono 16kHz WAV — the canonical input format for speech-to-text. */
export async function extractAudio(input: string, output: string): Promise<string> {
  await fs.mkdir(path.dirname(output), {recursive: true});
  await ffmpeg(['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output], {quiet: true});
  return output;
}

/** Extract a full-quality stereo WAV (48 kHz) for the master audio mix. */
export async function extractAudioHQ(input: string, output: string): Promise<string> {
  await fs.mkdir(path.dirname(output), {recursive: true});
  await ffmpeg(['-i', input, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', output], {quiet: true});
  return output;
}

/**
 * Mux a rendered (muted) video with the finished audio mix.
 * `-shortest` is deliberately NOT used: the mix is already padded to the plan
 * duration and trimming is driven by the video length.
 */
export async function muxAudio(
  video: string,
  audio: string,
  output: string,
  opts: {audioBitrate?: string} = {},
): Promise<string> {
  await fs.mkdir(path.dirname(output), {recursive: true});
  await ffmpeg([
    '-i', video,
    '-i', audio,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', opts.audioBitrate ?? '192k',
    '-movflags', '+faststart',
    output,
  ], {quiet: true});
  return output;
}

export interface SilenceInterval {
  start: number;
  end: number;
}

/** Detect silent passages (seconds). Used for pause detection / silence cuts. */
export async function detectSilence(
  input: string,
  opts: {noiseDb?: number; minDur?: number} = {},
): Promise<SilenceInterval[]> {
  const noiseDb = opts.noiseDb ?? -35;
  const minDur = opts.minDur ?? 0.5;
  // silencedetect logs to stderr on a successful run; ffmpeg() returns that log.
  const stderr = await ffmpeg([
    '-i', input,
    '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`,
    '-f', 'null', '-',
  ]);
  const out: SilenceInterval[] = [];
  const starts: number[] = [];
  const reStart = /silence_start:\s*([0-9.]+)/g;
  const reEnd = /silence_end:\s*([0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = reStart.exec(stderr))) starts.push(Number(m[1]));
  const ends: number[] = [];
  while ((m = reEnd.exec(stderr))) ends.push(Number(m[1]));
  for (let i = 0; i < ends.length; i++) {
    out.push({start: starts[i] ?? 0, end: ends[i]});
  }
  return out;
}

export interface KeepSegment {
  start: number;
  end: number;
}

/**
 * Cut a source into `keep` segments (seconds) and concatenate them, dropping
 * everything else. Frame-accurate via filter_complex trim + concat.
 */
export async function cutSegments(
  input: string,
  keep: KeepSegment[],
  output: string,
  opts: {fps?: number; width?: number; height?: number} = {},
): Promise<string> {
  if (keep.length === 0) throw new Error('cutSegments: empty keep list');
  await fs.mkdir(path.dirname(output), {recursive: true});
  const parts: string[] = [];
  const labels: string[] = [];
  keep.forEach((seg, i) => {
    const dur = Math.max(0.05, seg.end - seg.start);
    parts.push(
      `[0:v]trim=start=${seg.start.toFixed(3)}:end=${(seg.start + dur).toFixed(3)},setpts=PTS-STARTPTS${opts.fps ? `,fps=${opts.fps}` : ''}[v${i}]`,
      `[0:a]atrim=start=${seg.start.toFixed(3)}:end=${(seg.start + dur).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`,
    );
    labels.push(`[v${i}][a${i}]`);
  });
  const filter =
    parts.join(';') +
    ';' +
    labels.join('') +
    `concat=n=${keep.length}:v=1:a=1[cv][ca]` +
    (opts.width && opts.height ? `;[cv]scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease,pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2:black[outv]` : ';[cv]null[outv]');
  await ffmpeg([
    '-i', input,
    '-filter_complex', filter,
    '-map', '[outv]', '-map', '[ca]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k',
    output,
  ], {quiet: true});
  return output;
}

/** Concatenate already-decoded same-codec files (file list written to disk). */
export async function concatFiles(files: string[], output: string): Promise<string> {
  await fs.mkdir(path.dirname(output), {recursive: true});
  const listFile = output + '.concat.txt';
  const body = files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n');
  await fs.writeFile(listFile, body, 'utf8');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output], {quiet: true});
  await fs.unlink(listFile).catch(() => undefined);
  return output;
}

export interface ReframeOptions {
  width: number;
  height: number;
  /** 0..1 horizontal focal point of the subject (0.5 = center) */
  focalX?: number;
  /** 0..1 vertical focal point (0.5 = center) */
  focalY?: number;
  /** 'cover' crops to fill, 'contain' letterboxes */
  mode?: 'cover' | 'contain';
}

/**
 * Aspect-ratio conversion with focal-point reframing.
 * Uses the planner's focal point (face/subject hint) rather than blind center crop.
 */
export async function reframe(input: string, output: string, opts: ReframeOptions): Promise<string> {
  await fs.mkdir(path.dirname(output), {recursive: true});
  const fx = opts.focalX ?? 0.5;
  const fy = opts.focalY ?? 0.5;
  const {width, height} = opts;
  let vf: string;
  if (opts.mode === 'contain') {
    vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
  } else {
    // crop to fill around focal point: compute cover scale then offset crop window
    vf =
      `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height}:` +
      `'(iw-ow)*${fx.toFixed(3)}':'(ih-oh)*${fy.toFixed(3)}'`;
  }
  await ffmpeg(['-i', input, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'copy', output], {quiet: true});
  return output;
}

/** Scale/pad a single image to the target frame (for image → video plates). */
export async function prepareImage(input: string, output: string, width: number, height: number): Promise<string> {
  await fs.mkdir(path.dirname(output), {recursive: true});
  await ffmpeg(
    ['-i', input, '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`, '-frames:v', '1', output],
    {quiet: true},
  );
  return output;
}

export interface MixInput {
  src: string;
  role: AudioRoleLike;
  /** linear gain 0..1+ */
  volume?: number;
  /** position on the timeline in seconds */
  delay?: number;
  /** hard trim of this source (seconds) */
  duration?: number;
}

type AudioRoleLike = 'voiceover' | 'music' | 'sfx' | 'ambience' | 'source';

export interface MixOptions {
  sampleRate?: number;
  /**
   * Total timeline length in seconds. Required whenever any source lacks an
   * explicit `duration` — each stream is padded to exactly this length and the
   * output is trimmed to it, which is what makes `amix` terminate.
   */
  totalSec?: number;
  /** sidechain threshold for music ducking (0..1, default 0.04) */
  duckThreshold?: number;
  /** compressor release in ms (default 620) */
  duckReleaseMs?: number;
}

/**
 * Mix narration + music (+ sfx) into one master WAV with real sidechain
 * ducking: music is compressed automatically whenever narration plays.
 *
 * Filtergraph discipline: every labelled pad is consumed exactly once, so
 * narration that feeds both the duck sidechain and the final mix is explicitly
 * split — otherwise ffmpeg rejects the graph. All streams are padded and
 * trimmed to `totalSec`, so the result has an exact, known length.
 */
export async function mixAudio(inputs: MixInput[], output: string, opts: MixOptions = {}): Promise<string> {
  if (inputs.length === 0) throw new Error('mixAudio: no inputs');
  await fs.mkdir(path.dirname(output), {recursive: true});
  const sr = opts.sampleRate ?? 48000;
  const duckThreshold = opts.duckThreshold ?? 0.04;
  const release = opts.duckReleaseMs ?? 620;

  const explicit = Math.max(0, ...inputs.map((i) => (i.delay ?? 0) + (i.duration ?? 0)));
  const total = opts.totalSec ?? explicit;
  if (!(total > 0)) {
    throw new Error('mixAudio: timeline length unknown — pass opts.totalSec or give every input a duration');
  }
  const totalStr = total.toFixed(3);

  const args: string[] = [];
  inputs.forEach((inp) => args.push('-i', inp.src));

  const filters: string[] = [];
  // Per-input conditioning: resample → optional trim → optional delay → gain →
  // pad to the timeline length → hard bound.
  inputs.forEach((inp, i) => {
    const vol = inp.volume ?? 1;
    const parts = [`[${i}:a]aresample=${sr}`, 'aformat=sample_fmts=fltp:channel_layouts=stereo'];
    if (inp.duration != null) parts.push(`atrim=0:${inp.duration.toFixed(3)}`, 'asetpts=PTS-STARTPTS');
    if (inp.delay && inp.delay > 0) parts.push(`adelay=${Math.round(inp.delay * 1000)}:all=1`);
    if (vol !== 1) parts.push(`volume=${vol}`);
    parts.push(`apad=whole_dur=${totalStr}`, `atrim=0:${totalStr}`);
    filters.push(`${parts.join(',')}[m${i}]`);
  });

  const label = (i: number) => `[m${i}]`;
  const voices = inputs.map((x, i) => ({x, i})).filter((e) => e.x.role === 'voiceover' || e.x.role === 'source');
  const music = inputs.map((x, i) => ({x, i})).filter((e) => e.x.role === 'music');
  const others = inputs.map((x, i) => ({x, i})).filter((e) => e.x.role === 'sfx' || e.x.role === 'ambience');

  // 1) Voice bus — summed behind a fresh label so it can be split later.
  let voiceBus: string | null = null;
  if (voices.length === 1) {
    filters.push(`${label(voices[0].i)}anull[vb]`);
    voiceBus = '[vb]';
  } else if (voices.length > 1) {
    filters.push(`${voices.map((v) => label(v.i)).join('')}amix=inputs=${voices.length}:duration=longest:normalize=0[vb]`);
    voiceBus = '[vb]';
  }

  // 2) Music bus.
  let musicBus: string | null = null;
  if (music.length === 1) {
    filters.push(`${label(music[0].i)}anull[mb]`);
    musicBus = '[mb]';
  } else if (music.length > 1) {
    filters.push(`${music.map((m) => label(m.i)).join('')}amix=inputs=${music.length}:duration=longest:normalize=0[mb]`);
    musicBus = '[mb]';
  }

  // 3) Duck the music under narration with a sidechain compressor.
  const pads: string[] = [];
  if (musicBus && voiceBus) {
    filters.push(`${voiceBus}asplit=2[voice][vkey]`);
    filters.push(`${musicBus}[vkey]sidechaincompress=threshold=${duckThreshold}:ratio=8:attack=25:release=${release}[mbd]`);
    pads.push('[voice]', '[mbd]');
  } else {
    if (voiceBus) pads.push(voiceBus);
    if (musicBus) pads.push(musicBus);
  }
  others.forEach((o) => pads.push(label(o.i)));

  // 4) Final master mix.
  if (pads.length === 0) throw new Error('mixAudio: no usable streams');
  filters.push(
    pads.length === 1
      ? `${pads[0]}anull[aout]`
      : `${pads.join('')}amix=inputs=${pads.length}:duration=longest:normalize=0[aout]`,
  );

  await ffmpeg(
    [
      ...args,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[aout]',
      '-t',
      totalStr,
      '-ar',
      String(sr),
      '-c:a',
      'pcm_s16le',
      output,
    ],
    {quiet: true},
  );
  return output;
}

/** Generate a thumbnail JPEG at a given time. */
export async function thumbnail(input: string, output: string, timeSec = 0): Promise<string> {
  await fs.mkdir(path.dirname(output), {recursive: true});
  await ffmpeg(['-ss', String(timeSec), '-i', input, '-frames:v', '1', '-q:v', '2', output], {quiet: true});
  return output;
}

/** Normalize loudness of a track (EBU R128) — used for voiceover/master. */
export async function loudnorm(input: string, output: string, targetI = -16): Promise<string> {
  await fs.mkdir(path.dirname(output), {recursive: true});
  await ffmpeg(['-i', input, '-af', `loudnorm=I=${targetI}:TP=-1.5:LRA=11`, '-ar', '48000', output], {quiet: true});
  return output;
}

/**
 * Detect genuinely black frames (missing media, failed scene load) for QC.
 *
 * Thresholds are deliberately conservative: `pixTh` counts a pixel as black
 * below this luma fraction, and blackdetect requires `picTh` of the frame to be
 * black. A default of 0.04 (~10/255) means moody or dark-graded footage is NOT
 * reported as black — only frames that are actually empty.
 */
export async function detectBlackFrames(
  input: string,
  opts: {pixTh?: number; picTh?: number; minDur?: number} = {},
): Promise<SilenceInterval[]> {
  const pixTh = opts.pixTh ?? 0.04;
  const picTh = opts.picTh ?? 0.98;
  const minDur = opts.minDur ?? 0.25;
  const stderr = await ffmpeg([
    '-i', input,
    '-vf', `blackdetect=d=${minDur}:pix_th=${pixTh}:pic_th=${picTh}`,
    '-an', '-f', 'null', '-',
  ]);
  const out: SilenceInterval[] = [];
  const re = /black_start:\s*([0-9.]+)\s+black_end:\s*([0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr))) out.push({start: Number(m[1]), end: Number(m[2])});
  return out;
}

/**
 * Average frame luma (0..255) sampled over time — used to judge how dark a
 * passage really is instead of guessing from a binary black/not-black flag.
 */
export async function frameLumaSeries(input: string, sampleFps = 2): Promise<number[]> {
  const stderr = await ffmpeg([
    '-i', input,
    '-vf', `fps=${sampleFps},signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
    '-an', '-f', 'null', '-',
  ]);
  const out: number[] = [];
  const re = /lavfi\.signalstats\.YAVG=([0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr))) out.push(Number(m[1]));
  return out;
}

/** Peak audio level (dB) via volumedetect — QC clipping check. */
export async function audioPeakDb(input: string): Promise<{meanDb: number; maxDb: number}> {
  const stderr = await ffmpeg(['-i', input, '-af', 'volumedetect', '-f', 'null', '-']);
  const max = /max_volume:\s*(-?[0-9.]+) dB/.exec(stderr);
  const mean = /mean_volume:\s*(-?[0-9.]+) dB/.exec(stderr);
  return {
    maxDb: max ? Number(max[1]) : -Infinity,
    meanDb: mean ? Number(mean[1]) : -Infinity,
  };
}