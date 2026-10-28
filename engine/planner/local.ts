/**
 * Local deterministic planner — turns analysis + brief (+ transcript) into a
 * complete VideoPlan without any external service. This is the guaranteed
 * fallback path; the LLM planner (engine/ai) may override it when a key exists.
 *
 * Every mode (A..G) is handled here; creative choices come from the visual
 * recipe lexicon and editorial rules, execution stays deterministic.
 */
import type {AnalysisResult} from '../input/analyzer';
import type {
  AudioTrackSpec,
  CaptionCue,
  FormatSpec,
  OverlaySpec,
  Ratio,
  Scene,
  SceneTransition,
  VideoPlan,
} from '../types';
import {DEFAULT_FPS, resolveFormat} from '../types';
import {getStyle} from '../../styles/tokens';
import {matchRecipe, recipeFor, recipeScene, relevanceScore, type VisualRecipe} from './visuals';
import {chunkSegments, type CutPlan} from '../editor/cuts';
import type {Segment} from '../../providers/stt/index';

export interface Brief {
  prompt?: string;
  topic?: string;
  title?: string;
  duration?: number;
  ratio?: Ratio;
  fps?: number;
  style?: string;
  language?: string;
  captions?: boolean;
  music?: boolean;
  name?: string;
  role?: string;
  /** force narration synthesis even when input audio already exists */
  voiceover?: boolean;
  /** Input file reserved for style analysis; it is not used as production footage. */
  referencePath?: string;
  /** Measured characteristics from an optional reference video. */
  referenceSignature?: {
    pacing: 'slow'|'measured'|'brisk'|'rapid';
    averageShotSec: number;
    aspect: 'vertical'|'square'|'landscape';
    meanLuma?: number;
    sceneCutsSec: number[];
  };
}

export interface PlannedAsset {
  /** staged name inside the project public dir (staticFile path) */
  staged: string;
  /** original source path (for ffmpeg-side work) */
  path: string;
  kind: 'video' | 'image' | 'audio';
}

export interface NarrationTrack {
  staged: string;
  duration: number;
  /** timeline position in seconds */
  start: number;
  /** index of the beat it belongs to */
  beat: number;
}

export interface PlanContext {
  analysis: AnalysisResult;
  brief: Brief;
  format: FormatSpec;
  /** transcript segments aligned to the timeline (post-cut for mode A) */
  segments?: Segment[];
  /** duration of edited source / narration audio in seconds */
  sourceDuration?: number;
  /** mode A: staged cut video + keep list */
  cut?: {staged: string; wavStaged: string; plan: CutPlan};
  assets: PlannedAsset[];
  narration?: NarrationTrack[];
  transcriptAvailable: boolean;
}

export interface PlanResult {
  plan: VideoPlan;
  notes: string[];
}

/* ------------------------------ brief helpers ------------------------------ */

const RATIO_WORDS: Array<[RegExp, Ratio]> = [
  [/\b(reel|reels|short|shorts|tiktok|vertical|9:16|portrait)\b/i, '9:16'],
  [/\b(square|1:1|instagram feed)\b/i, '1:1'],
  [/\b(4:5|portrait feed)\b/i, '4:5'],
  [/\b(16:9|landscape|youtube(?! shorts)|widescreen|cinema)\b/i, '16:9'],
];

export function resolveRatio(brief: Brief): Ratio {
  if (brief.ratio) return brief.ratio;
  const text = `${brief.prompt ?? ''} ${brief.topic ?? ''}`;
  for (const [re, ratio] of RATIO_WORDS) if (re.test(text)) return ratio;
  return '16:9';
}

export function resolveFormatFromBrief(brief: Brief): FormatSpec {
  return resolveFormat(resolveRatio(brief), brief.fps ?? DEFAULT_FPS);
}

const STYLE_WORDS: Array<[RegExp, string]> = [
  [/\b(reel|shorts?|tiktok|vertical)\b/i, 'reels'],
  [/\b(youtube|vlog|podcast)\b/i, 'youtube'],
  [/\b(3d|three-?d|motion graphics)\b/i, '3d-motion'],
  [/\b(2d|animation|animated|cartoon|story)\b/i, '2d-animation'],
  [/\b(horror|scary|thriller|creep)\b/i, 'horror-story'],
  [/\b(documentary|docu)\b/i, 'documentary'],
  [/\b(ad|ads|advertisement|commercial|promo)\b/i, 'advertisement'],
  [/\b(explain|explainer|tutorial|educational|lesson)\b/i, 'explainer'],
  [/\b(corporate|business|presentation|training)\b/i, 'corporate'],
  [/\b(minimal|clean|elegant)\b/i, 'minimal'],
  [/\b(cinematic|film|moody)\b/i, 'cinematic'],
];

export function resolveStyle(brief: Brief, mode: AnalysisResult['mode'], recipes: VisualRecipe[]): string {
  if (brief.style) return brief.style;
  const text = `${brief.prompt ?? ''} ${brief.topic ?? ''}`;
  for (const [re, style] of STYLE_WORDS) if (re.test(text)) return style;
  if (mode === 'video+audio') return resolveRatio(brief) === '9:16' ? 'reels' : 'youtube';
  const twoD = recipes.filter((r) => r.sceneType === 'two-d').length;
  if (recipes.length > 0 && twoD / recipes.length >= 0.5) return '2d-animation';
  return 'cinematic';
}

/* ------------------------------ text helpers ------------------------------ */

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function groupBeats(text: string, targetWords = 14): string[] {
  const sentences = splitSentences(text);
  const beats: string[] = [];
  let current: string[] = [];
  let count = 0;
  const flush = () => {
    if (current.length > 0) {
      beats.push(current.join(' '));
      current = [];
      count = 0;
    }
  };
  for (const s of sentences) {
    const w = s.split(/\s+/).length;
    if (count > 0 && count + w > targetWords + 6) flush();
    current.push(s);
    count += w;
    if (count >= targetWords) flush();
  }
  flush();
  return beats;
}

const estimateSeconds = (text: string, wps = 2.6): number =>
  Math.max(2.2, text.split(/\s+/).length / wps);

/* ------------------------------ plan assembly ------------------------------ */

let seq = 0;
const nextId = (prefix: string) => `${prefix}${String(++seq).padStart(2, '0')}`;

const newScene = (s: Partial<Scene> & Pick<Scene, 'type' | 'start' | 'duration'>): Scene =>
  ({...s, id: s.id ?? nextId('s')} as Scene);

export function planVideo(ctx: PlanContext): PlanResult {
  seq = 0;
  const notes: string[] = [];
  const {analysis} = ctx;

  if (analysis.mode === 'video+audio' && ctx.cut) {
    return planTalkingHead(ctx, notes);
  }
  // Editorially, transcribed narration is the spine: if we have a transcript of
  // audio the user supplied, scenes follow the spoken content — whatever the
  // mode label says and whether or not a brief was also given. Supplied stills
  // are then placed as B-roll by keyword inside planNarration().
  if (ctx.segments && ctx.segments.length > 0 && analysis.hasAudioMedia) {
    return planNarration(ctx, notes);
  }
  if (analysis.mode === 'prompt-only') {
    return planPrompt(ctx, notes);
  }
  // script-driven paths (script-only, images+script, mixed, video without speech)
  return planScriptDriven(ctx, notes);
}

/* -------------------------- MODE A: talking head -------------------------- */

const planTalkingHead = (ctx: PlanContext, notes: string[]): PlanResult => {
  const {brief, format, cut, segments, assets} = ctx;
  if (!cut) throw new Error('talking-head planning requires a cut');

  const duration = ctx.sourceDuration ?? cut.plan.keep.reduce((a, s) => a + (s.end - s.start), 0);
  const sourceVideo = ctx.analysis.inputs.find((input) => input.kind === 'video');
  const needsSafeReframe = Boolean(sourceVideo?.width && sourceVideo?.height &&
    Math.abs(sourceVideo.width / sourceVideo.height - format.width / format.height) > 0.22);
  const gaps = segments
    ? segments.flatMap((s) => [{start: s.startMs / 1000, end: s.endMs / 1000}])
    : undefined;
  const chunks = chunkSegments(cut.plan.keep, {maxLen: 6.5, wordGaps: gaps});

  const scenes: Scene[] = [];
  let cursor = 0;
  chunks.forEach((chunk, i) => {
    const len = Math.max(0.5, chunk.end - chunk.start);
    const punch = i % 2 === 1; // alternate subtle punch-ins — never constant motion
    scenes.push(
      newScene({
        type: 'clip',
        start: cursor,
        duration: len,
        src: cut!.staged,
        camera: 'static',
        purpose: i === 0 ? 'hook' : undefined,
        data: {
          ...(punch ? {punchIn: 1.07, punchRamp: 1.6} : {}),
          trimBeforeSec: chunk.start,
          ...(sourceVideo?.width && sourceVideo?.height ? {sourceWidth: sourceVideo.width, sourceHeight: sourceVideo.height} : {}),
          ...(needsSafeReframe ? {reframeMode: 'blur-fill-contain'} : {}),
        },
      }),
    );
    cursor += len;
  });
  if (scenes.length > 0) scenes[0].purpose = 'hook';

  // ---------- B-roll: only where narration keywords match an asset name ----------
  const overlays: OverlaySpec[] = [];
  const mediaAssets = assets.filter((a) => a.kind === 'image' || a.kind === 'video');
  if (segments && segments.length > 0 && mediaAssets.length > 0) {
    const busy: Array<[number, number]> = [];
    const placed = new Map<string, number>();
    const scored: Array<{asset: PlannedAsset; seg: Segment; score: number; at: number}> = [];
    for (const asset of mediaAssets) {
      let best: {seg: Segment; score: number; at: number} | null = null;
      for (const seg of segments) {
        const score = relevanceScore(seg.text, asset.path.split(/[\\/]/).pop() ?? '');
        if (score > 0 && (!best || score > best.score)) {
          best = {seg, score, at: seg.startMs / 1000};
        }
      }
      if (best) scored.push({asset, ...best});
    }
    scored.sort((a, b) => b.score - a.score);
    for (const {asset, at} of scored) {
      if (placed.has(asset.staged)) continue;
      const start = Math.min(Math.max(0.2, at), Math.max(0.2, duration - 2.5));
      const end = Math.min(duration, start + 3.4);
      if (busy.some(([b, e]) => start < e && end > b)) continue;
      busy.push([start, end]);
      placed.set(asset.staged, start);
      scenes.push(
        newScene({
          type: asset.kind === 'image' ? 'image' : 'clip',
          track: 'overlay',
          start,
          duration: end - start,
          src: asset.staged,
          camera: 'push-in',
        }),
      );
      notes.push(`B-roll "${asset.staged}" placed at ${start.toFixed(1)}s (keyword match)`);
    }
  }
  if (mediaAssets.length > 0 && !segments) {
    notes.push('B-roll skipped: no transcript available to match against narration.');
  }

  // ---------- lower third ----------
  if (brief.name) {
    overlays.push({
      id: 'lt1',
      kind: 'lower-third',
      start: 0.6,
      duration: 4,
      title: brief.name,
      subtitle: brief.role,
      position: 'bottom-left',
    });
  }

  // ---------- audio ----------
  const audio: AudioTrackSpec[] = [
    {id: 'source', src: cut.wavStaged, role: 'source', start: 0, volume: 1},
  ];
  const music = ctx.assets.find((a) => a.kind === 'audio');
  if (music && brief.music !== false) {
    audio.push({id: 'music', src: music.staged, role: 'music', start: 0, volume: 0.3, duck: true});
    notes.push(`Music bed "${music.staged}" ducked under narration`);
  }

  // ---------- captions ----------
  let captions: VideoPlan['captions'];
  if (segments && brief.captions !== false) {
    const cues: CaptionCue[] = segments.flatMap((seg) =>
      seg.words.map((w) => ({text: w.text, startMs: w.startMs, endMs: w.endMs})),
    );
    captions = {cues, style: {mode: 'word'}};
    notes.push(`Captions generated from transcript (${captions.cues.length} cues)`);
  }

  const style = resolveStyle(brief, ctx.analysis.mode, []);
  const tokens = getStyle(style);
  const plan: VideoPlan = {
    version: 1,
    title: brief.title ?? (brief.prompt ?? 'Talking head'),
    format,
    duration: round2(duration),
    style,
    scenes: scenes.sort((a, b) => a.start - b.start),
    audio,
    overlays: overlays.length ? overlays : undefined,
    captions,
    defaultTransition: tokens.transition,
  };
  notes.push(`Cut removed ${cut.plan.removed.toFixed(1)}s of dead air across ${cut.plan.keep.length} kept segments`);
  return {plan, notes};
};

/* ----------------------- MODE C: audio-only narration ----------------------- */

const planNarration = (ctx: PlanContext, notes: string[]): PlanResult => {
  const {brief, format, segments = [], assets} = ctx;
  const audioDur = ctx.sourceDuration ?? (segments[segments.length - 1]?.endMs ?? 0) / 1000;

  // merge micro segments (<1.6s) into the previous scene
  const beats: Segment[] = [];
  for (const seg of segments) {
    const prev = beats[beats.length - 1];
    if (prev && seg.startMs / 1000 - prev.startMs / 1000 < 1.6) {
      prev.text += ' ' + seg.text;
      prev.endMs = seg.endMs;
      prev.words.push(...seg.words);
    } else {
      beats.push({...seg, words: [...seg.words]});
    }
  }

  const recipes = beats.map((b, i) => recipeFor(b.text, brief.style, i));
  const style = resolveStyle(brief, ctx.analysis.mode, recipes);
  const tokens = getStyle(style);
  const images = assets.filter((a) => a.kind === 'image');

  const scenes: Scene[] = [];
  beats.forEach((beat, i) => {
    const start = beat.startMs / 1000;
    const nextStart = beats[i + 1] ? beats[i + 1].startMs / 1000 : audioDur;
    const duration = Math.max(1.2, Math.min(nextStart, audioDur) - start);
    const recipe = recipes[i];
    const image = pickImage(images, beat.text, i);
    const base: Scene = {
      id: nextId('s'),
      type: recipe.sceneType,
      start: round2(start),
      duration: round2(duration),
      purpose: i === 0 ? 'hook' : i === beats.length - 1 ? 'outro' : undefined,
      narration: beat.text,
      visual: beat.text,
      camera: recipe.camera,
    };
    if (image && recipe.sceneType !== 'three-d') {
      // real asset beats procedural when it matches the words
      scenes.push({...base, type: 'image', src: image.staged, camera: 'push-in'});
    } else {
      scenes.push(recipeScene(base, recipe));
    }
    if (i === 0 && brief.title) {
      scenes[0].text = [{role: 'title', text: brief.title, y: 0.26}];
    }
  });

  const narrationAsset = assets.find((a) => a.kind === 'audio');
  const audio: AudioTrackSpec[] = [];
  if (narrationAsset) {
    audio.push({id: 'voice', src: narrationAsset.staged, role: 'voiceover', start: 0, volume: 1});
  } else {
    notes.push('No narration audio staged — visuals only');
  }
  const musicAsset = assets.filter((a) => a.kind === 'audio')[1];
  if (musicAsset && brief.music !== false) {
    audio.push({id: 'music', src: musicAsset.staged, role: 'music', start: 0, volume: 0.26, duck: true});
  }

  let captions: VideoPlan['captions'];
  if (brief.captions !== false) {
    captions = {
      cues: segments.flatMap((seg) => seg.words.map((w) => ({text: w.text, startMs: w.startMs, endMs: w.endMs}))),
      style: {mode: 'word'},
    };
  }

  const plan: VideoPlan = {
    version: 1,
    title: brief.title ?? brief.prompt ?? 'Narration',
    format,
    duration: round2(audioDur),
    style,
    scenes,
    audio,
    captions,
    defaultTransition: tokens.transition,
  };
  notes.push(`${beats.length} scenes derived from narration (${ctx.transcriptAvailable ? 'whisper transcript' : 'segments'})`);
  return {plan, notes};
};

const pickImage = (images: PlannedAsset[], text: string, index: number): PlannedAsset | null => {
  if (images.length === 0) return null;
  let best: {img: PlannedAsset; score: number} | null = null;
  for (const img of images) {
    const score = relevanceScore(text, img.path.split(/[\\/]/).pop() ?? '');
    if (score > 0 && (!best || score > best.score)) best = {img, score};
  }
  return best ? best.img : images[index % images.length];
};

/* --------------------------- MODE D/F: script --------------------------- */

const planScriptDriven = (ctx: PlanContext, notes: string[]): PlanResult => {
  const {brief, format, analysis, assets} = ctx;
  const script = analysis.text ?? brief.prompt ?? '';

  if (!script.trim()) {
    notes.push('No script text found — falling back to prompt-style plan');
    return planPrompt(ctx, notes);
  }

  const beats = groupBeats(script, 14);
  const recipes = beats.map((b, i) => recipeFor(b, brief.style, i));
  const style = resolveStyle(brief, analysis.mode, recipes);
  const tokens = getStyle(style);
  const images = assets.filter((a) => a.kind === 'image');
  const hasNarration = Boolean(ctx.narration && ctx.narration.length > 0);

  const scenes: Scene[] = [];
  /** where each synthesized narration clip lands on the finished timeline */
  const voSchedule: Array<{beat: number; staged: string; start: number; duration: number}> = [];
  let cursor = 0;

  // title card only when it won't desync synthesized narration
  if (brief.title && !hasNarration && beats.length > 0) {
    const len = Math.min(2.6, analysis.mode === 'prompt-only' ? 3 : 2.6);
    scenes.push(
      newScene({
        type: 'title',
        start: 0,
        duration: len,
        purpose: 'hook',
        text: [
          {role: 'title', text: brief.title},
          ...(brief.topic ? [{role: 'subtitle', text: brief.topic}] : []),
        ],
      }),
    );
    cursor = len;
  }

  beats.forEach((beat, i) => {
    const narrationTrack = ctx.narration?.find((n) => n.beat === i);
    const duration = narrationTrack ? narrationTrack.duration + 0.35 : estimateSeconds(beat);
    // the narration clip must sit at the start of ITS scene, not at zero,
    // otherwise every line plays over the first few seconds of the video
    if (narrationTrack) {
      voSchedule.push({beat: i, staged: narrationTrack.staged, start: Math.round(cursor * 100) / 100, duration: narrationTrack.duration});
    }
    const recipe = recipes[i];
    const image = pickImage(images, beat, i);
    const base: Scene = {
      id: nextId('s'),
      type: recipe.sceneType,
      start: round2(cursor),
      duration: round2(duration),
      narration: beat,
      visual: beat,
      purpose: i === 0 ? (scenes.length === 0 ? 'hook' : undefined) : i === beats.length - 1 ? 'outro' : undefined,
      camera: recipe.camera,
      transitionIn: tokens.transition,
    };
    if (image && images.length > 0) {
      scenes.push({...base, type: 'image', src: image.staged, camera: i % 2 === 0 ? 'push-in' : 'pan-right'});
    } else {
      scenes.push(recipeScene(base, recipe));
    }
    cursor += duration;
  });

  const audio: AudioTrackSpec[] = [];
  if (hasNarration) {
    for (const v of voSchedule) {
      audio.push({id: `vo${v.beat}`, src: v.staged, role: 'voiceover', start: v.start, volume: 1});
    }
    notes.push(`Narration: ${voSchedule.length} synthesized clips placed on timeline`);
  } else {
    notes.push('No TTS voiceover available — visuals timed to estimated reading pace');
  }
  const music = assets.find((a) => a.kind === 'audio');
  if (music && brief.music !== false) {
    audio.push({id: 'music', src: music.staged, role: 'music', start: 0, volume: 0.28, duck: true});
  }

  let captions: VideoPlan['captions'];
  if (ctx.segments && ctx.segments.length > 0 && brief.captions !== false) {
    captions = {
      cues: ctx.segments.flatMap((seg) => seg.words.map((w) => ({text: w.text, startMs: w.startMs, endMs: w.endMs}))),
      style: {mode: 'word'},
    };
  }

  const plan: VideoPlan = {
    version: 1,
    title: brief.title ?? brief.prompt?.slice(0, 60) ?? 'Untitled',
    format,
    duration: round2(cursor || estimateSeconds(script)),
    style,
    scenes,
    audio,
    captions,
    defaultTransition: tokens.transition,
  };
  if (scenes.length === 0) {
    scenes.push(newScene({type: 'title', start: 0, duration: 4, text: [{role: 'title', text: plan.title ?? 'Untitled'}]}));
    plan.duration = 4;
  }
  notes.push(`${scenes.length} scenes planned from ${beats.length} script beats (${analysis.mode})`);
  return {plan, notes};
};

/* --------------------------- MODE E: prompt only --------------------------- */

const planPrompt = (ctx: PlanContext, notes: string[]): PlanResult => {
  const {brief, format} = ctx;
  const prompt = brief.prompt ?? brief.topic ?? 'Untitled';
  const duration = brief.duration ?? 15;
  const recipes = [recipeFor(prompt, brief.style, 0)];
  const style = resolveStyle(brief, 'prompt-only', recipes);
  const tokens = getStyle(style);

  // Local (no-LLM) prompt mode builds an original typographic/motion piece
  // from the prompt itself — no fake narration, no invented story.
  const fragments = groupBeats(prompt, 8).slice(0, 6);
  const scenes: Scene[] = [];
  const titleLen = Math.min(3, duration * 0.25);
  scenes.push(
    newScene({
      type: 'title',
      start: 0,
      duration: round2(titleLen),
      purpose: 'hook',
      text: [{role: 'title', text: fragments[0] ?? prompt.slice(0, 40)}],
    }),
  );
  const bodyCount = Math.max(1, fragments.length - 1);
  const bodyDur = (duration - titleLen) / bodyCount;
  fragments.slice(1).forEach((frag, i) => {
    const r = recipeFor(frag, brief.style, i + 1);
    scenes.push(
      recipeScene(
        {
          id: nextId('s'),
          type: r.sceneType,
          start: round2(titleLen + i * bodyDur),
          duration: round2(bodyDur),
          visual: frag,
          camera: r.camera,
          text: [{role: 'title', text: frag, y: 0.78, size: 56}],
          transitionIn: tokens.transition,
        },
        r,
      ),
    );
  });
  if (scenes.length === 1) {
    scenes.push(
      recipeScene(
        {
          id: nextId('s'),
          type: recipes[0].sceneType,
          start: round2(titleLen),
          duration: round2(duration - titleLen),
          visual: prompt,
          camera: recipes[0].camera,
          transitionIn: tokens.transition,
        },
        recipes[0],
      ),
    );
  }

  const plan: VideoPlan = {
    version: 1,
    title: prompt.slice(0, 60),
    format,
    duration,
    style,
    scenes,
    audio: [],
    defaultTransition: tokens.transition,
  };
  notes.push('Prompt-only mode: LLM unavailable — built motion-graphics piece from prompt text (no invented narration)');
  return {plan, notes};
};

/* ------------------------------ utilities ------------------------------ */

const round2 = (n: number) => Math.round(n * 100) / 100;

export const defaultBriefFromPrompt = (prompt: string): Brief => ({prompt, topic: prompt});