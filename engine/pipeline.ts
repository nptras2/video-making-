/**
 * Production pipeline — the one function that turns "here is my material and
 * what I want" into a finished video.
 *
 *   INPUT → UNDERSTAND → PLAN → STORYBOARD → ASSETS → TIMELINE → AUDIO →
 *   CAPTIONS → RENDER → MUX → QC → OUTPUT
 *
 * Design rules enforced here:
 *   • every capability is probed first; a missing provider degrades to a stated
 *     local fallback instead of crashing or faking a result
 *   • the plan is written to disk before rendering, so a run is inspectable and
 *     reproducible
 *   • Remotion renders picture only; FFmpeg builds the master audio mix and
 *     muxes it, so ducking/loudness are exact and deterministic
 *   • failures carry the real ffmpeg/provider diagnostics
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {AudioTrackSpec, FormatSpec, ProviderStatus, Ratio, VideoPlan} from './types';
import {resolveFormat} from './types';
import {analyzeInputs, collectInputs, type AnalysisResult} from './input/analyzer';
import {
  extractAudio,
  extractAudioHQ,
  muxAudio,
  probe,
  cutSegments,
  mixAudio,
  thumbnail,
  MediaError,
} from './media/ffmpeg';
import {planSilenceCuts, remapWordsToCut, type CutPlan} from './editor/cuts';
import {
  groupBeats,
  planVideo,
  resolveFormatFromBrief,
  resolveRatio,
  type Brief,
  type NarrationTrack,
  type PlannedAsset,
  type PlanContext,
} from './planner/local';
import {planVideoSmart} from './ai/index';
import {draftNarration} from './ai/director';
import {matchRecipe} from './planner/visuals';
import {getStyle} from '../styles/tokens';
import {renderPlan} from './render/render';
import {runQc, renderQcReport, type QcReport} from './qc/index';
import {toSrt, toVtt, toPlainText} from './captions/index';
import {renderStoryboard} from './storyboard/index';
import {directPlan} from './director/index';
import {analyzeReference, type ReferenceSignature} from './media/reference';
import {
  addRevision,
  initProject,
  pathsFor,
  readState,
  stageAsset,
  updateState,
  writePlan,
  writeState,
  writeTextFile,
  type ProjectPaths,
} from './project/manager';
import {
  getSttProvider,
  normalizeWords,
  speechWords,
  wordsToCues,
  wordsToSegments,
  type Segment,
  type Word,
} from '../providers/stt/index';
import {getVoiceProvider} from '../providers/voice/index';
import {getImageProvider, sceneImagePrompt} from '../providers/image/index';
import {synthesizeBed, type MusicMood} from '../providers/music/index';
import {anyStockAvailable, downloadStock, narrationToQuery, searchStock} from '../providers/media/index';
import {capabilityReport} from '../providers/index';
import type {ProviderStatus as ProviderStatusType} from './types';

/* --------------------------------- types --------------------------------- */

export type PipelineStep =
  | 'inputs'
  | 'analyze'
  | 'providers'
  | 'ingest'
  | 'transcribe'
  | 'cut'
  | 'broll'
  | 'plan'
  | 'voice'
  | 'storyboard'
  | 'captions'
  | 'mix'
  | 'render'
  | 'mux'
  | 'qc'
  | 'done';

export interface PipelineEvent {
  step: PipelineStep;
  message: string;
  level: 'info' | 'warn' | 'error';
}

export interface CreateOptions {
  /** project name (also used for the folder slug) */
  name?: string;
  /** files or directories */
  inputs: string[];
  brief: Brief;
  render?: boolean;
  preview?: boolean;
  skipQc?: boolean;
  onEvent?: (e: PipelineEvent) => void;
}

export interface CreateResult {
  projectId: string;
  projectDir: string;
  plan: VideoPlan;
  notes: string[];
  warnings: string[];
  providers: ProviderStatus[];
  qc?: QcReport;
  outputs: {
    plan: string;
    storyboard: string;
    final?: string;
    preview?: string;
    thumbnail?: string;
    srt?: string;
    vtt?: string;
    transcript?: string;
    qc?: string;
  };
  usedLlm: boolean;
}

/* --------------------------------- helpers --------------------------------- */

const MB = 1_048_576;
const execFileAsync = promisify(execFile);

/** Expand directories into concrete files. */
async function resolveInputs(inputs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of inputs) {
    const abs = path.resolve(raw);
    let st;
    try {
      st = await fs.stat(abs);
    } catch {
      throw new Error(`input not found: ${raw}`);
    }
    if (st.isDirectory()) out.push(...(await collectInputs(abs)));
    else out.push(abs);
  }
  return out;
}

/** Evenly spread words across a span — the honest fallback when STT is off. */
function estimateWordCues(text: string, startMs: number, endMs: number): Segment {
  const parts = text.split(/\s+/).filter(Boolean);
  const span = Math.max(200, endMs - startMs);
  const words: Word[] = parts.map((w, i) => ({
    text: w,
    startMs: Math.round(startMs + (span * i) / parts.length),
    endMs: Math.round(startMs + (span * (i + 1)) / parts.length),
  }));
  return {text, startMs, endMs, words};
}

const styleMood = (styleName: string): MusicMood => {
  const map: Record<string, MusicMood> = {
    cinematic: 'wonder',
    documentary: 'serious',
    youtube: 'upbeat',
    reels: 'upbeat',
    corporate: 'serious',
    minimal: 'calm',
    '2d-animation': 'calm',
    '3d-motion': 'wonder',
    'horror-story': 'tense',
    explainer: 'upbeat',
    advertisement: 'upbeat',
  };
  return map[styleName] ?? 'calm';
};

/* ------------------------------ the pipeline ------------------------------ */

export async function createVideo(opts: CreateOptions): Promise<CreateResult> {
  const emit = (step: PipelineStep, message: string, level: PipelineEvent['level'] = 'info') =>
    opts.onEvent?.({step, message, level});

  const notes: string[] = [];
  const warnings: string[] = [];
  const note = (m: string, level: PipelineEvent['level'] = 'info') => {
    notes.push(m);
    if (level === 'warn') warnings.push(m);
    emit('plan', level === 'info' ? m : `[${level}] ${m}`, level);
  };

  /* ------------------------------ 1. inputs ------------------------------ */
  const files = await resolveInputs(opts.inputs);
  emit('inputs', files.length === 0 ? 'no input files — prompt-only production' : `${files.length} input file(s)`);

  const brief: Brief = {...opts.brief};
  const analysis = await analyzeInputs(files, brief.prompt);
  emit('analyze', `mode ${analysis.mode} (${analysis.inputs.map((i) => `${i.kind}:${i.duration?.toFixed(1) ?? '?'}s`).join(', ') || 'text only'})`);
  let referenceSignature: ReferenceSignature | undefined;
  const referencePath = typeof brief.referencePath === 'string' ? brief.referencePath : undefined;
  if (referencePath) {
    try {
      emit('analyze', `measuring reference editing style: ${path.basename(referencePath)}`);
      referenceSignature = await analyzeReference(referencePath);
      brief.referenceSignature = {
        pacing: referenceSignature.pacing,
        averageShotSec: referenceSignature.averageShotSec,
        aspect: referenceSignature.aspect,
        meanLuma: referenceSignature.meanLuma,
        sceneCutsSec: referenceSignature.sceneCutsSec,
      };
      emit('analyze', `reference: ${referenceSignature.sceneCutsSec.length} detected cuts, ${referenceSignature.averageShotSec.toFixed(1)}s avg shot, ${referenceSignature.pacing} pace`);
    } catch (e) {
      warnings.push(`reference analysis failed: ${(e as Error).message.split('\\n')[0]}`);
    }
  }

  /* ----------------------------- 2. providers ----------------------------- */
  const caps = await capabilityReport({deep: true});
  const providerStatus: ProviderStatus[] = caps.statuses;
  const p = (name: string) => caps.statuses.find((s) => s.name === name);
  const hasStt = Boolean(p('whisper.cpp (base)')?.available || caps.statuses.find((s) => s.kind === 'stt')?.available);
  emit('providers', `providers probed (${caps.missing.length} capability gap(s))`);
  for (const m of caps.missing) warnings.push(m);

  /* ------------------------------ 3. project ------------------------------ */
  const briefForFormat: Brief = {...brief, fps: brief.fps};
  const format: FormatSpec = brief.ratio || brief.fps ? resolveFormatFromBrief(briefForFormat) : resolveFormat(brief.ratio ?? resolveRatio(brief), brief.fps ?? 30);
  const projectName = opts.name ?? brief.title ?? brief.prompt?.slice(0, 48) ?? 'video';
  const {paths} = await initProject({
    name: projectName,
    brief: brief as Record<string, unknown>,
    inputs: analysis.inputs,
    style: brief.style ?? 'cinematic',
    format,
    providers: providerStatus,
    notes: [],
  });
  const projectId = path.basename(paths.dir);
  emit('analyze', `project ${projectId}`);
  if (referenceSignature) {
    await writeTextFile(path.join(paths.dir, 'reference-analysis.json'), JSON.stringify(referenceSignature, null, 2));
    note(`Reference style measured: ${referenceSignature.pacing} pace, ${referenceSignature.sceneCutsSec.length} cuts, ${referenceSignature.aspect} aspect; reference content is excluded from the edit.`);
  }

  /* ------------------------------ 4. ingest ------------------------------ */
  const assets: PlannedAsset[] = [];
  const credits: string[] = [];
  const videos = analysis.inputs.filter((i) => i.kind === 'video');
  const images = analysis.inputs.filter((i) => i.kind === 'image');
  const audios = analysis.inputs.filter((i) => i.kind === 'audio');

  const primaryVideo = videos.find((v) => v.hasAudio);
  const brollVideos = videos.filter((v) => v !== primaryVideo);

  for (const img of images) {
    assets.push({staged: await stageAsset(paths, img.path), path: img.path, kind: 'image'});
  }
  for (const v of brollVideos) {
    assets.push({staged: await stageAsset(paths, v.path), path: v.path, kind: 'video'});
  }
  for (const a of audios) {
    assets.push({staged: await stageAsset(paths, a.path), path: a.path, kind: 'audio'});
  }
  emit('ingest', `${assets.length} asset(s) staged into the project`);

  /* ------------------- 5. transcription + editorial cut ------------------- */
  let segments: Segment[] | undefined;
  let cut: PlanContext['cut'];
  let sourceDuration: number | undefined;
  let transcriptText: string | undefined;
  let transcriptProvider: string | undefined;
  let transcriptAvailable = false;
  const narration: NarrationTrack[] = [];

  const stt = await getSttProvider();
  const voice = await getVoiceProvider();

  if (analysis.mode === 'video+audio' && primaryVideo) {
    emit('transcribe', `extracting audio from ${path.basename(primaryVideo.path)}`);
    const fullAudio = await extractAudio(primaryVideo.path, path.join(paths.work, 'audio-full.wav'));
    let words: Word[] = [];
    if (stt.provider) {
      try {
        const t = await stt.provider.transcribe(fullAudio, {language: brief.language});
        words = t.words;
        transcriptText = t.text;
        transcriptProvider = t.provider;
        transcriptAvailable = words.length > 0;
        emit('transcribe', `${words.length} words via ${t.provider}`);
      } catch (e) {
        warnings.push(`transcription failed: ${(e as Error).message.split('\n')[0]}`);
        emit('transcribe', `transcription failed — continuing without captions`, 'warn');
      }
    } else {
      warnings.push(`no speech-to-text provider (${stt.status.detail}) — captions and keyword B-roll unavailable`);
      emit('transcribe', 'no STT provider — silence-based editing only', 'warn');
    }

    const originalSegments = words.length > 0 ? wordsToSegments(words) : undefined;

    emit('cut', 'planning silence-based cuts');
    const cutPlan = await planSilenceCuts(primaryVideo.path, {
      maxGap: 0.75,
      keepGap: 0.28,
      minKeep: 0.4,
    });
    const cutVideo = path.join(paths.work, 'cut.mp4');
    await cutSegments(primaryVideo.path, cutPlan.keep, cutVideo, {fps: format.fps});
    const cutWav = await extractAudioHQ(cutVideo, path.join(paths.work, 'cut.wav'));
    const staged = await stageAsset(paths, cutVideo, 'source.mp4');
    const wavStaged = await stageAsset(paths, cutWav, 'source.wav');
    cut = {staged, wavStaged, plan: cutPlan};

    const keptInfo = await probe(cutVideo);
    sourceDuration = keptInfo.duration;
    emit(
      'cut',
      `removed ${cutPlan.removed.toFixed(1)}s of dead air (${cutPlan.keep.length} kept segments) → ${keptInfo.duration.toFixed(1)}s`,
    );

    // Markers removed and subword tokens merged into real words BEFORE
    // remapping, so keyword matching, the drop count and captions all see
    // actual words ("Ships", not "Sh" + "ips").
    const speakable = normalizeWords(speechWords(words));
    if (transcriptAvailable && cutPlan.removed > 0.05) {
      // one transcription, remapped onto the edited timeline
      const remapped = remapWordsToCut(speakable, cutPlan.keep);
      segments = wordsToSegments(remapped.words);
      emit('transcribe', `caption timings remapped to the edited timeline (${remapped.words.length} words)`);
      if (remapped.driftAdjusted > 0) {
        note(
          `${remapped.driftAdjusted} word(s) sat slightly outside a cut boundary due to speech-to-text timing drift ` +
            `and were anchored to the nearest kept segment rather than dropped.`,
        );
      }
      if (remapped.dropped > 0) {
        warnings.push(`${remapped.dropped} transcribed word(s) fell outside the edited timeline and were not captioned.`);
      }
      void originalSegments;
    } else if (transcriptAvailable) {
      segments = originalSegments ? wordsToSegments(speakable) : undefined;
    }
    note(`Editorial cut: ${cutPlan.removed.toFixed(1)}s removed across ${cutPlan.keep.length} segments.`);
  } else if (analysis.mode === 'audio-only' || (audios.length > 0 && !primaryVideo)) {
    const narrationAudio = audios[0];
    emit('transcribe', `transcribing narration audio (${(narrationAudio.duration ?? 0).toFixed(1)}s)`);
    sourceDuration = narrationAudio.duration;
    if (stt.provider) {
      const wav16 = await extractAudio(narrationAudio.path, path.join(paths.work, 'narration-16k.wav'));
      try {
        const t = await stt.provider.transcribe(wav16, {language: brief.language});
        transcriptText = t.text;
        transcriptProvider = t.provider;
        transcriptAvailable = t.words.length > 0;
        segments = wordsToSegments(t.words);
        emit('transcribe', `${t.words.length} words, ${segments.length} utterance(s) via ${t.provider}`);
      } catch (e) {
        warnings.push(`transcription failed: ${(e as Error).message.split('\n')[0]}`);
      }
    } else {
      warnings.push(`no speech-to-text provider (${stt.status.detail}) — narration cannot be understood or captioned`);
      emit('transcribe', 'no STT provider — audio-driven scene planning unavailable', 'warn');
    }
  }

  /* ------------------- 6. drafting a script when none exists ------------------- */
  // Only when the user gave a brief but no script AND the material does not
  // already carry its own narration — otherwise a supplied transcript wins.
  const needsDraftedScript =
    !analysis.text?.trim() &&
    Boolean(brief.prompt) &&
    brief.voiceover !== false &&
    analysis.mode !== 'audio-only' &&
    analysis.mode !== 'video+audio' &&
    analysis.mode !== 'video-only' &&
    (analysis.mode === 'prompt-only' || analysis.mode === 'mixed');
  if (needsDraftedScript) {
    emit('voice', 'no script supplied — asking the AI director to draft one');
    const draft = await draftNarration(brief, {tone: brief.style});
    if (draft.text) {
      analysis.text = draft.text;
      analysis.mode = 'script-only';
      note(`AI director drafted a ${draft.text.split(/\s+/).length}-word narration script (${draft.provider}).`);
      await writeTextFile(path.join(paths.work, 'drafted-script.txt'), draft.text);
    } else {
      note(
        `No script and no LLM available (${draft.reason}) — building a motion-graphics piece from the prompt text itself. ` +
          `No narration was invented.`,
        'warn',
      );
    }
  }

  /* ------------------------------ 7. voiceover ------------------------------ */
  const wantsVoice =
    brief.voiceover !== false &&
    analysis.mode !== 'video+audio' &&
    analysis.mode !== 'audio-only' &&
    Boolean(analysis.text && analysis.text.trim().length > 0);

  if (wantsVoice) {
    if (!voice.provider) {
      note(`No TTS provider (${voice.status.detail}) — scenes are timed to an estimated reading pace, no narration audio.`, 'warn');
    } else {
      const beats = groupBeats(analysis.text!, 14);
      emit('voice', `synthesizing narration (${beats.length} beats via ${voice.status.name})`);
      const voDir = path.join(paths.work, 'vo');
      await fs.mkdir(voDir, {recursive: true});
      try {
        for (let i = 0; i < beats.length; i++) {
          const raw = path.join(voDir, `beat-${i}.wav`);
          await voice.provider.speak(beats[i], raw, {rate: brief.style === 'reels' ? 1.08 : 1});
          const staged = await stageAsset(paths, raw, `vo-${String(i).padStart(2, '0')}.wav`);
          narration.push({staged, duration: (await probe(raw)).duration, start: 0, beat: i});
        }
        note(`Narration synthesized locally: ${narration.length} clips (${voice.status.name}).`);
      } catch (e) {
        narration.length = 0;
        note(`Narration synthesis failed (${(e as Error).message.split('\n')[0]}) — continuing without voiceover.`, 'warn');
      }
    }
  }

  /* ------------------------- 8. automatic B-roll ------------------------- */
  if (anyStockAvailable() && analysis.mode !== 'prompt-only') {
    const targets: Array<{text: string; at: number}> = segments
      ? segments.map((s) => ({text: s.text, at: s.startMs / 1000}))
      : analysis.text
        ? groupBeats(analysis.text, 14).map((b, i) => ({text: b, at: i * 5}))
        : [];
    const picks = targets.filter((_, i) => i % 2 === 0).slice(0, 4);
    for (const t of picks) {
      const q = narrationToQuery(t.text);
      if (!q) continue;
      try {
        const res = await searchStock(q, {kind: 'video', perPage: 4, orientation: isVertical(format) ? 'portrait' : 'landscape', minWidth: 960});
        const best = res.assets[0];
        if (!best) continue;
        const dest = path.join(paths.work, 'broll', `${best.id}.mp4`);
        await downloadStock(best, dest);
        const staged = await stageAsset(paths, dest, `broll-${best.id}.mp4`);
        assets.push({staged, path: dest, kind: 'video'});
        credits.push(`${best.credit} — search "${q}"`);
        emit('broll', `stock B-roll "${q}" → ${best.provider}`);
      } catch (e) {
        warnings.push(`stock B-roll "${q}" failed: ${(e as Error).message.split('\n')[0]}`);
      }
    }
  } else if (!anyStockAvailable() && analysis.mode !== 'prompt-only') {
    notes.push('Automatic stock B-roll skipped: no stock API key (PEXELS_API_KEY / PIXABAY_API_KEY / UNSPLASH_ACCESS_KEY).');
  }

  /* -------------------------------- 9. plan -------------------------------- */
  const planCtx: PlanContext = {
    analysis,
    brief,
    format,
    segments,
    sourceDuration,
    cut,
    assets,
    narration: narration.length > 0 ? narration : undefined,
    transcriptAvailable,
  };
  emit('plan', 'planning the timeline');
  const planned = await planVideoSmart(planCtx);
  const plan = planned.plan;
  const directorSource = analysis.text ?? brief.prompt ?? brief.topic ?? plan.title ?? '';
  const director = directPlan(plan, directorSource, planned.usedLlm ? 'llm-assisted' : 'deterministic-local');
  if (referenceSignature) applyReferencePacing(plan, referenceSignature, note);
  await writeTextFile(path.join(paths.dir, 'director-analysis.json'), JSON.stringify(director, null, 2));
  await writeTextFile(path.join(paths.dir, 'characters.json'), JSON.stringify(director.characters, null, 2));
  note(`Director analyzed ${director.story.length} beats, ${director.characters.length} stable character identity(ies), mood ${director.mood}, setting ${director.setting.place ?? director.setting.timeOfDay}.`);
  for (const n of planned.notes) note(n);
  if (planned.usedLlm) emit('plan', 'AI director planned the timeline');
  else if (planned.fallbackReason) emit('plan', `local planner used (${planned.fallbackReason})`, 'warn');

  /* ------------------------ 10. generated imagery ------------------------ */
  if (getImageProvider().provider && analysis.mode === 'prompt-only') {
    const tokens = getStyle(plan.style);
    const imgProvider = getImageProvider().provider!;
    for (const scene of plan.scenes) {
      if (scene.type !== 'abstract' && scene.type !== 'title') continue;
      const desc = scene.visual ?? scene.narration ?? brief.prompt;
      if (!desc) continue;
      try {
        const file = path.join(paths.work, 'gen', `${scene.id}.png`);
        await imgProvider.generate({
          prompt: sceneImagePrompt(desc, {style: tokens.label, mood: matchRecipe(desc).mood}),
          output: file,
          width: format.width,
          height: format.height,
        });
        const staged = await stageAsset(paths, file, `gen-${scene.id}.png`);
        scene.type = 'image';
        scene.src = staged;
        scene.camera = scene.camera ?? 'push-in';
        emit('plan', `generated still for ${scene.id}`);
      } catch (e) {
        warnings.push(`image generation failed for ${scene.id}: ${(e as Error).message.split('\n')[0]}`);
        break;
      }
    }
  } else if (!getImageProvider().provider && analysis.mode === 'prompt-only') {
    notes.push(`AI image generation unavailable: ${getImageProvider().why}`);
  }

  /* ------------------ 10b. semantic Blender 3D scenes ------------------ */
  const blenderScenes = plan.scenes.filter((scene) => scene.type === 'three-d');
  if (blenderScenes.length > 0) {
    const blender = await findBlender();
    if (blender) {
      for (const scene of blenderScenes) {
        const outDir = path.join(paths.work, 'blender', scene.id);
        const maxDim = 960;
        const scale = Math.min(1, maxDim / format.width, maxDim / format.height);
        const width = Math.max(320, Math.floor(format.width * scale / 2) * 2);
        const height = Math.max(320, Math.floor(format.height * scale / 2) * 2);
        const renderFps = Math.min(12, format.fps);
        const script = path.join(process.cwd(), 'engine', '3d', 'render_scene.py');
        try {
          emit('render', `Blender 3D scene ${scene.id}: ${scene.visual?.slice(0, 72) ?? scene.narration?.slice(0,72) ?? 'authored 3D shot'}`);
          await execFileAsync(blender, ['-b', '--python', script, '--', '--visual', scene.visual ?? scene.narration ?? brief.prompt ?? 'product explainer', '--output', outDir, '--duration', String(Math.min(12, scene.duration)), '--fps', String(renderFps), '--width', String(width), '--height', String(height)], {timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024});
          const movie = path.join(outDir, 'scene.mp4');
          const staged = await stageAsset(paths, movie, `blender-${scene.id}.mp4`);
          scene.src = staged;
          scene.type = 'clip';
          scene.renderBackend = 'blender';
          scene.data = {...(scene.data ?? {}), blenderSourceType: 'procedural-3d', blenderSourceFps: renderFps, blenderSourceResolution: `${width}x${height}`};
          note(`Blender generated a semantic procedural 3D scene (${width}×${height}@${renderFps}fps; stylized 3D, not AI photorealism).`);
        } catch (e) {
          warnings.push(`Blender rendering ${scene.id} failed; using Remotion 3D fallback: ${(e as Error).message.split('\\n')[0]}`);
          scene.renderBackend = 'remotion';
        }
      }
    } else {
      notes.push('Blender not found: using Remotion React Three Fiber procedural 3D fallback (not a Blender scene).');
    }
  }

  /* ------------------------------- 11. music ------------------------------- */
  const hasMusic = plan.audio.some((a) => a.role === 'music');
  if (!hasMusic && brief.music !== false) {
    const tokens = getStyle(plan.style);
    const mood = styleMood(plan.style);
    const bedPath = path.join(paths.work, 'music-bed.wav');
    try {
      emit('mix', `synthesizing a ${mood} music bed (${plan.duration.toFixed(1)}s, offline)`);
      await synthesizeBed({durationSec: plan.duration + 0.5, mood, output: bedPath, gain: 0.34});
      const staged = await stageAsset(paths, bedPath, 'music-bed.wav');
      const track: AudioTrackSpec = {id: 'music', src: staged, role: 'music', start: 0, volume: 0.32, duck: true};
      plan.audio.push(track);
      note(`Music bed synthesized locally (${mood}) — a tonal ambient bed, not a licensed track.`);
      void tokens;
    } catch (e) {
      warnings.push(`music bed synthesis failed: ${(e as Error).message.split('\n')[0]}`);
    }
  } else if (hasMusic) {
    notes.push('Music supplied with the inputs — no synthetic bed was generated.');
  }

  /* ------------------------ 12. captions for narration ------------------------ */
  if (wantsVoice && narration.length > 0 && brief.captions !== false && !plan.captions) {
    // Build the narration on its timeline, then transcribe THAT so captions match
    // the actual synthesized speech instead of estimated word timing.
    try {
      const voTimeline = path.join(paths.work, 'vo-timeline.wav');
      const voInputs = narration
        .map((n) => {
          const track = plan.audio.find((a) => a.src === n.staged);
          return track ? {src: path.join(paths.publicDir, n.staged), role: 'voiceover' as const, delay: track.start} : null;
        })
        .filter((x): x is {src: string; role: 'voiceover'; delay: number} => Boolean(x));
      if (voInputs.length > 0) {
        // Timeline length = end of the last narration clip on the timeline.
        const voTotal = narration.reduce((max, n) => {
          const track = plan.audio.find((a) => a.src === n.staged);
          return Math.max(max, (track?.start ?? 0) + n.duration);
        }, 0);
        await mixAudio(voInputs, voTimeline, {sampleRate: 48000, totalSec: voTotal + 0.05});
        if (stt.provider) {
          const wav16 = await extractAudio(voTimeline, path.join(paths.work, 'vo-16k.wav'));
          const t = await stt.provider.transcribe(wav16, {language: brief.language});
          if (t.words.length > 0) {
            plan.captions = {cues: t.words.map((w) => ({text: w.text, startMs: w.startMs, endMs: w.endMs})), style: {mode: getStyle(plan.style).caption.mode}};
            note(`Captions transcribed from the synthesized narration (${t.words.length} words via ${t.provider}).`);
          }
        }
        if (!plan.captions) {
          // honest fallback: word timings distributed across each beat's real audio
          const cues: Segment[] = [];
          for (const n of narration) {
            const track = plan.audio.find((a) => a.src === n.staged);
            const beat = groupBeats(analysis.text!, 14)[n.beat] ?? '';
            if (!beat) continue;
            const start = (track?.start ?? 0) * 1000;
            cues.push(estimateWordCues(beat, start, start + n.duration * 1000));
          }
          if (cues.length > 0) {
            plan.captions = {cues: cues.flatMap((c) => c.words), style: {mode: getStyle(plan.style).caption.mode}};
            note('Caption timings estimated evenly across each narration clip (speech-to-text unavailable).', 'warn');
          }
        }
      }
    } catch (e) {
      warnings.push(`caption generation for narration failed: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  /* --------------------------- 13. persist the plan --------------------------- */
  const finalDuration = plan.scenes.reduce((max, s) => Math.max(max, s.start + s.duration), 0);
  if (finalDuration > 0) plan.duration = Math.round(finalDuration * 100) / 100;
  await writePlan(paths, plan);
  emit('plan', `plan written: ${plan.scenes.length} scenes, ${plan.duration.toFixed(1)}s, style ${plan.style}`);

  /* ------------------------------ 14. storyboard ------------------------------ */
  const storyboard = renderStoryboard(plan, {
    projectId,
    mode: analysis.mode,
    format,
    style: plan.style,
    providers: providerStatus.filter((s) => s.available).map((s) => s.name),
    notes,
    credits,
  });
  await writeTextFile(paths.storyboard, storyboard);
  emit('storyboard', 'STORYBOARD.md written');

  /* ------------------------------- 15. captions ------------------------------- */
  const outputs: CreateResult['outputs'] = {plan: paths.plan, storyboard: paths.storyboard};
  if (plan.captions && plan.captions.cues.length > 0) {
    await writeTextFile(paths.captionsSrt, toSrt(plan.captions));
    await writeTextFile(paths.captionsVtt, toVtt(plan.captions, {title: plan.title}));
    await writeTextFile(path.join(paths.output, 'transcript.txt'), toPlainText(plan.captions));
    outputs.srt = paths.captionsSrt;
    outputs.vtt = paths.captionsVtt;
    emit('captions', `captions exported (SRT + VTT)`);
  }
  if (transcriptText && transcriptProvider) {
    await writeTextFile(
      paths.transcript,
      JSON.stringify(
        {provider: transcriptProvider, text: transcriptText, segments: segments ?? [], words: segments?.flatMap((s) => s.words) ?? []},
        null,
        2,
      ),
    );
    outputs.transcript = paths.transcript;
  }

  /* -------------------------------- 16. audio -------------------------------- */
  let mixPath: string | undefined;
  if (plan.audio.length > 0) {
    emit('mix', `building the master audio mix (${plan.audio.length} track(s))`);
    const inputs = plan.audio.map((a) => ({
      src: path.join(paths.publicDir, a.src),
      role: a.role,
      volume: a.volume,
      delay: a.start,
      duration: a.role === 'music' ? plan.duration : undefined,
    }));
    mixPath = await mixAudio(inputs, paths.audioMix, {sampleRate: 48000, totalSec: plan.duration});
    emit('mix', 'master mix ready (sidechain-ducked music under narration)');
  } else {
    notes.push('No audio tracks in this plan — the result is a silent picture.');
  }

  /* --------------------------------- 17. render --------------------------------- */
  if (opts.render !== false) {
    let lastPct = -1;
    emit('render', `rendering ${plan.format.width}×${plan.format.height} @ ${plan.format.fps}fps`);
    const picture = path.join(paths.work, 'picture.mp4');
    await renderPlan({
      plan,
      publicDir: paths.publicDir,
      output: picture,
      scale: 1,
      crf: 18,
      onProgress: (prog) => {
        const pct = Math.floor(prog * 100);
        if (pct >= lastPct + 20) {
          lastPct = pct;
          emit('render', `rendering… ${pct}%`);
        }
      },
    });

    emit('mux', 'muxing the master audio mix into the picture');
    if (mixPath) {
      await muxAudio(picture, mixPath, paths.final);
    } else {
      await fs.copyFile(picture, paths.final);
    }
    outputs.final = paths.final;

    await thumbnail(paths.final, paths.thumbnail, Math.min(plan.duration * 0.25, plan.duration - 0.1)).catch(() => undefined);
    if (await exists(paths.thumbnail)) outputs.thumbnail = paths.thumbnail;
    emit('done', `final render: ${outputs.final} (${((await fs.stat(paths.final)).size / MB).toFixed(1)} MB)`);

    /* ---------------------------------- 18. QC ---------------------------------- */
    if (!opts.skipQc) {
      emit('qc', 'running quality control');
      const report = await runQc({plan, file: paths.final});
      await writeTextFile(paths.qc, renderQcReport(report, {projectId, file: paths.final, planDuration: plan.duration}));
      outputs.qc = paths.qc;
      emit('qc', `QC: ${report.level}`, report.level === 'pass' ? 'info' : 'warn');
      const state = await readState(paths);
      state.files = {...outputs} as Record<string, string>;
      await writeState(paths, state);
      const result: CreateResult = {
        projectId,
        projectDir: paths.dir,
        plan,
        notes,
        warnings,
        providers: providerStatus,
        qc: report,
        outputs,
        usedLlm: planned.usedLlm,
      };
      await finalise(paths, result, analysis);
      return result;
    }
  }

  /* -------------------------------- finish -------------------------------- */
  const result: CreateResult = {
    projectId,
    projectDir: paths.dir,
    plan,
    notes,
    warnings,
    providers: providerStatus,
    outputs,
    usedLlm: planned.usedLlm,
  };
  await finalise(paths, result, analysis);
  return result;
}

const exists = async (file: string): Promise<boolean> => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

const isVertical = (format: FormatSpec): boolean => format.height > format.width;

async function findBlender(): Promise<string | undefined> {
  const candidates = [process.env.BLENDER_PATH, path.join(process.cwd(), 'tools', 'blender-5.2.3-windows-x64', 'blender.exe'), path.join(process.cwd(), 'tools', 'blender', 'blender.exe'), 'blender'].filter((x): x is string => Boolean(x));
  for (const candidate of candidates) {
    if (candidate === 'blender') {
      try { await execFileAsync(candidate, ['--version'], {timeout: 15000}); return candidate; } catch { continue; }
    }
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

function applyReferencePacing(plan: VideoPlan, signature: ReferenceSignature, note: (message: string, level?: 'info'|'warn') => void): void {
  const targets = plan.scenes.filter((scene) => scene.track !== 'overlay');
  if (!targets.length) return;
  // Reference-driven rhythm only; do not transfer its content, images or exact cut times.
  const transition = signature.pacing === 'rapid'
    ? {type: 'none' as const, duration: 0}
    : signature.pacing === 'brisk'
      ? {type: 'dissolve' as const, duration: 0.2}
      : signature.pacing === 'measured'
        ? {type: 'dissolve' as const, duration: 0.4}
        : {type: 'fade' as const, duration: 0.6};
  plan.defaultTransition = transition;
  for (const scene of targets) {
    scene.transitionIn = transition;
    scene.data = {...(scene.data ?? {}), referencePacing: signature.pacing, referenceAverageShotSec: signature.averageShotSec};
    if (scene.type !== 'clip' && scene.type !== 'title' && scene.type !== 'card') {
      scene.shot = signature.pacing === 'rapid' ? 'tight visual beat; brisk editorial rhythm' : signature.pacing === 'slow' ? 'held composition; deliberate editorial rhythm' : 'measured composition following reference rhythm';
    }
  }
  note(`Reference editing signature applied: ${signature.pacing} pace (${signature.averageShotSec.toFixed(1)}s mean shot), ${transition.type} transitions. Timeline/audio timing preserved; reference content was not reused.`);
}

async function finalise(paths: ProjectPaths, result: CreateResult, analysis: AnalysisResult): Promise<void> {
  const state = await readState(paths);
  state.files = {...state.files, ...(result.outputs as Record<string, string>)};
  state.style = result.plan.style;
  state.format = result.plan.format;
  state.notes = result.notes;
  state.brief = {...state.brief, mode: analysis.mode, duration: result.plan.duration, llm: result.usedLlm};
  await writeState(paths, state);
  await addRevision(paths, `Initial production — ${result.plan.scenes.length} scenes, ${result.plan.duration.toFixed(1)}s`);
}

/* ------------------------- revision / re-render path ------------------------- */

export interface ReviseOptions {
  project: string;
  note: string;
  /** patch the saved brief before re-planning, e.g. {captions: false} */
  briefPatch?: Brief;
  /** re-plan from scratch (default) or re-render the existing plan */
  replan?: boolean;
  render?: boolean;
  skipQc?: boolean;
  onEvent?: (e: PipelineEvent) => void;
}

/**
 * Revise an existing project. Re-planning keeps every staged asset on disk, so
 * a revision costs one render — not a rebuild of the whole project.
 */
export async function reviseVideo(opts: ReviseOptions): Promise<CreateResult> {
  const paths = pathsFor(path.resolve(opts.project));
  const state = await readState(paths);
  await addRevision(paths, opts.note);

  const brief: Brief = {...(state.brief as Brief), ...(opts.briefPatch ?? {})};
  const inputs = state.inputs.map((i) => i.path);
  return createVideo({
    name: state.name,
    inputs: state.inputs.length > 0 ? [] : inputs, // already staged; avoid re-ingesting
    brief: {...brief, note: opts.note} as Brief,
    render: opts.render,
    skipQc: opts.skipQc,
    onEvent: opts.onEvent,
  });
}

/** Re-render a saved plan without re-planning (fastest iteration loop). */
export async function renderExisting(
  project: string,
  opts: {scale?: number; skipQc?: boolean; onEvent?: (e: PipelineEvent) => void} = {},
): Promise<{final: string; qc?: QcReport}> {
  const paths = pathsFor(path.resolve(project));
  const plan: VideoPlan = JSON.parse(await fs.readFile(paths.plan, 'utf8')) as VideoPlan;
  opts.onEvent?.({step: 'render', message: `re-rendering saved plan (${plan.scenes.length} scenes)`, level: 'info'});
  const picture = path.join(paths.work, 'picture.mp4');
  await renderPlan({plan, publicDir: paths.publicDir, output: picture, scale: opts.scale ?? 1, crf: 18});
  let mix: string | undefined;
  if (plan.audio.length > 0) {
    mix = await mixAudio(
      plan.audio.map((a) => ({
        src: path.join(paths.publicDir, a.src),
        role: a.role,
        volume: a.volume,
        delay: a.start,
        duration: a.role === 'music' ? plan.duration : undefined,
      })),
      paths.audioMix,
      {sampleRate: 48000, totalSec: plan.duration},
    );
    await muxAudio(picture, mix, paths.final);
  } else {
    await fs.copyFile(picture, paths.final);
  }
  if (opts.skipQc) return {final: paths.final};
  const qc = await runQc({plan, file: paths.final});
  await writeTextFile(paths.qc, renderQcReport(qc, {file: paths.final, planDuration: plan.duration}));
  return {final: paths.final, qc};
}

export {MediaError, wordsToCues, resolveRatio};
export type {Ratio, ProviderStatusType};
