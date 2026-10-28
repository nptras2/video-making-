/**
 * AI planning layer — optional LLM director on top of the deterministic planner.
 *
 * The LLM never renders anything; it only *proposes* a VideoPlan as strict JSON,
 * which is then schema-validated and sanitised before any renderer touches it.
 * If the model is unavailable, returns invalid JSON, or proposes an impossible
 * timeline, we fall back to the local planner and say so in the run notes.
 *
 * Credentials (first match wins):
 *   OPENAI_API_KEY            — OpenAI or any OpenAI-compatible gateway via OPENAI_BASE_URL
 *   LLM_API_KEY + LLM_BASE_URL — provider-neutral escape hatch
 * Model: VIDEO_LLM_MODEL (default gpt-4o-mini)
 *
 * Atomicity of the timeline is enforced locally, not by the model:
 *   • scenes are sorted and clamped to the plan duration
 *   • overlaps are removed (base track becomes strictly sequential)
 *   • unknown scene types are mapped onto the registry
 *   • audio files that were never staged are dropped
 */
import {z} from 'zod';
import type {Scene, SceneType, VideoPlan} from '../types';
import type {Brief, PlanContext, PlanResult} from '../planner/local';
import {planVideo} from '../planner/local';
import {getStyle} from '../../styles/tokens';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  source: string;
}

/** Resolve LLM credentials from the environment, or null when unavailable. */
export function llmConfig(): LlmConfig | null {
  const model = process.env.VIDEO_LLM_MODEL || 'gpt-4o-mini';
  if (process.env.OPENAI_API_KEY) {
    return {
      baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      apiKey: process.env.OPENAI_API_KEY,
      model,
      source: 'OPENAI_API_KEY',
    };
  }
  if (process.env.LLM_API_KEY && process.env.LLM_BASE_URL) {
    return {
      baseUrl: process.env.LLM_BASE_URL.replace(/\/$/, ''),
      apiKey: process.env.LLM_API_KEY,
      model: process.env.VIDEO_LLM_MODEL || 'default',
      source: 'LLM_API_KEY',
    };
  }
  return null;
}

/* ------------------------------- schema (zod) ------------------------------- */

const SCENE_TYPES = ['clip', 'image', 'title', 'card', 'two-d', 'three-d', 'abstract'] as const;

const llmScene = z.object({
  type: z.string(),
  start: z.number(),
  duration: z.number(),
  purpose: z.string().optional(),
  narration: z.string().optional(),
  visual: z.string().optional(),
  src: z.string().optional(),
  camera: z.string().optional(),
  animation: z.string().optional(),
  text: z
    .array(
      z.object({
        text: z.string(),
        role: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        size: z.number().optional(),
        color: z.string().optional(),
      }),
    )
    .optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  layers: z.array(z.object({asset: z.string(), depth: z.number(), color: z.string().optional()})).optional(),
});

const llmPlan = z.object({
  title: z.string().optional(),
  style: z.string().optional(),
  duration: z.number().optional(),
  scenes: z.array(llmScene).min(1),
});

const SYSTEM_PROMPT = `You are a professional video director and editor planning a production timeline.
Return ONLY minified JSON — no prose, no markdown fences.

Schema:
{"title":string,"style":string,"duration":number,"scenes":[{
  "type":"clip"|"image"|"title"|"card"|"two-d"|"three-d"|"abstract",
  "start":number,"duration":number,"purpose":string,"narration":string,
  "visual":string,"src":string,"camera":"static"|"push-in"|"pull-out"|"pan-left"|"pan-right"|"pan-up"|"pan-down",
  "text":[{"text":string,"role":"title"|"subtitle"|"callout"|"stat","y":number}],
  "layers":[{"asset":"sky"|"stars"|"moon"|"mountains"|"sea"|"city"|"field"|"room"|"fog","depth":number,"color":string}],
  "data":{}
}]}

Rules:
- Scenes must be strictly sequential on the base track: scene[i].start + scene[i].duration == scene[i+1].start (start with 0). No gaps, no overlaps.
- Use "clip" ONLY with a src value from the provided asset list; never invent file paths.
- "two-d" needs layers; "abstract" or "three-d" are procedural (no assets needed).
- Use only the local asset filenames given to you.
- Editorial restraint: one clear idea per scene, no effect soup, cut only when it helps comprehension.
- Purpose values: hook, setup, evidence, payoff, outro.`;

/* --------------------------------- helpers --------------------------------- */

const normaliseType = (t: string): SceneType => {
  const key = t.toLowerCase().replace(/[^a-z-]/g, '');
  if ((SCENE_TYPES as readonly string[]).includes(key)) return key as SceneType;
  if (key === '2d' || key === 'twod' || key === 'animated') return 'two-d';
  if (key === '3d' || key === 'threed') return 'three-d';
  if (key === 'video' || key === 'footage') return 'clip';
  if (key === 'photo' || key === 'still') return 'image';
  if (key === 'text' || key === 'typography') return 'title';
  return 'abstract';
};

const CAMERAS = new Set(['static', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down']);
const normaliseCamera = (c?: string) => (c && CAMERAS.has(c) ? c : undefined) as Scene['camera'];

/** Sanitise a model-proposed plan into a renderable VideoPlan. */
export function sanitisePlan(raw: z.infer<typeof llmPlan>, ctx: PlanContext): {plan: VideoPlan; notes: string[]} {
  const notes: string[] = [];
  const staged = new Set(ctx.assets.map((a) => a.staged));
  const fps = ctx.format.fps;
  const maxDuration = Math.max(2, raw.duration ?? ctx.brief.duration ?? 30);

  let dropped = 0;
  const scenes: Scene[] = [];
  let cursor = 0;
  for (const s of raw.scenes) {
    const type = normaliseType(s.type);
    let src = s.src;
    if (type === 'clip' || type === 'image') {
      if (!src || !staged.has(src)) {
        dropped++;
        // demote to a procedural scene rather than render a broken reference
        continue;
      }
      src = staged.has(src) ? src : undefined;
    }
    const duration = Math.max(0.6, Math.min(12, s.duration || 3));
    if (cursor + duration > maxDuration + 0.5) break;
    scenes.push({
      id: `s${String(scenes.length + 1).padStart(2, '0')}`,
      type,
      start: Math.round(cursor * 100) / 100,
      duration: Math.round(duration * 100) / 100,
      purpose: s.purpose,
      narration: s.narration,
      visual: s.visual,
      src: type === 'clip' || type === 'image' ? src : undefined,
      camera: normaliseCamera(s.camera),
      animation: s.animation,
      text: s.text?.map((t) => ({...t, role: t.role ?? 'title'})),
      layers: s.layers?.map((l) => ({asset: l.asset, depth: Math.max(0, Math.min(1, l.depth)), color: l.color})),
      data: type === 'two-d' ? {...(s.data ?? {}), effects: (s.data?.effects as string) ?? 'none'} : s.data,
    });
    cursor += duration;
  }
  if (dropped > 0) notes.push(`LLM plan referenced ${dropped} asset(s) that were not staged — those scenes were dropped`);
  if (scenes.length === 0) throw new Error('LLM plan produced no renderable scenes after sanitising');

  const style = ctx.brief.style ?? raw.style ?? 'cinematic';
  const tokens = getStyle(style);
  const narrationAudio = ctx.assets.filter((a) => a.kind === 'audio');

  const plan: VideoPlan = {
    version: 1,
    title: raw.title ?? ctx.brief.title ?? ctx.brief.prompt ?? 'Untitled',
    format: ctx.format,
    duration: Math.round(cursor * 100) / 100,
    style: tokens.name,
    scenes,
    audio: narrationAudio.length
      ? [
          {id: 'voice', src: narrationAudio[0].staged, role: ctx.analysis.mode === 'video+audio' ? 'source' : 'voiceover', start: 0, volume: 1},
          ...narrationAudio.slice(1, 2).map((m) => ({id: 'music', src: m.staged, role: 'music' as const, start: 0, volume: 0.28, duck: true})),
        ]
      : ctx.cut
        ? [{id: 'source', src: ctx.cut.wavStaged, role: 'source' as const, start: 0, volume: 1}]
        : [],
    captions:
      ctx.segments && ctx.segments.length > 0 && ctx.brief.captions !== false
        ? {
            cues: ctx.segments.flatMap((seg) => seg.words.map((w) => ({text: w.text, startMs: w.startMs, endMs: w.endMs}))),
            style: {mode: tokens.caption.mode},
          }
        : undefined,
    defaultTransition: tokens.transition,
  };
  void fps;
  notes.push(`LLM director produced ${scenes.length} scenes, sanitised to sequential timeline of ${plan.duration.toFixed(1)}s`);
  return {plan, notes};
}

/* --------------------------------- the call --------------------------------- */

const buildUserPrompt = (ctx: PlanContext): string => {
  const {analysis, brief, format} = ctx;
  const script = (analysis.text ?? '').slice(0, 6000);
  const transcript = (ctx.segments ?? []).map((s) => s.text).join(' ').slice(0, 6000);
  const assets = ctx.assets.map((a) => `${a.staged} (${a.kind})`);
  return [
    `MODE: ${analysis.mode}`,
    `FORMAT: ${format.width}x${format.height} @ ${format.fps}fps (${format.ratio})`,
    `TARGET DURATION: ${brief.duration ?? 'auto'} seconds`,
    brief.style ? `STYLE: ${brief.style}` : '',
    brief.prompt ? `BRIEF: ${brief.prompt}` : '',
    brief.topic ? `TOPIC: ${brief.topic}` : '',
    analysis.inputs.length ? `INPUTS: ${analysis.inputs.map((i) => `${i.kind}${i.duration ? ` ${i.duration.toFixed(1)}s` : ''}`).join(', ')}` : '',
    assets.length ? `LOCAL ASSETS (use these exact filenames as src):\n${assets.join('\n')}` : 'LOCAL ASSETS: none (use procedural two-d/three-d/abstract/title scenes only)',
    transcript ? `SPOKEN CONTENT (already timed):\n${transcript}` : '',
    script ? `SCRIPT / SOURCE TEXT:\n${script}` : '',
    ctx.transcriptAvailable ? `TRANSCRIPT AVAILABLE: yes — align scene boundaries to the spoken content.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
};

export interface LlmPlanResult {
  usedLlm: boolean;
  plan: VideoPlan;
  notes: string[];
  fallbackReason?: string;
}

/**
 * Plan with the LLM when available, always returning a usable plan.
 * The deterministic planner is the contract; the LLM is an enhancement.
 */
export async function planVideoSmart(ctx: PlanContext): Promise<LlmPlanResult> {
  const local = (): PlanResult => planVideo(ctx);
  const cfg = llmConfig();
  if (!cfg) {
    const {plan, notes} = local();
    return {
      usedLlm: false,
      plan,
      notes: [...notes, 'AI director: no LLM credentials — used the deterministic local planner'],
      fallbackReason: 'no LLM credentials',
    };
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.4,
        response_format: {type: 'json_object'},
        messages: [
          {role: 'system', content: SYSTEM_PROMPT},
          {role: 'user', content: buildUserPrompt(ctx)},
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`${cfg.source} HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
    }
    const json = (await res.json()) as {choices?: Array<{message?: {content?: string}}>};
    const content = json.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) throw new Error('LLM returned an empty completion');

    const parsed = llmPlan.parse(JSON.parse(extractJson(content)));
    const {plan, notes} = sanitisePlan(parsed, ctx);
    return {
      usedLlm: true,
      plan,
      notes: [...notes, ...(ctx.brief.music === false ? [] : [])],
    };
  } catch (e) {
    const reason = (e as Error).message.split('\n')[0].slice(0, 220);
    const {plan, notes} = local();
    return {
      usedLlm: false,
      plan,
      notes: [...notes, `AI director unavailable/failed (${reason}) — fell back to the deterministic local planner`],
      fallbackReason: reason,
    };
  }
}

/** Tolerate markdown fences or stray prose around the JSON object. */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('no JSON object found in LLM response');
  return body.slice(start, end + 1);
}

export function llmStatus(): {name: string; available: boolean; detail: string} {
  const cfg = llmConfig();
  return cfg
    ? {name: `LLM director (${cfg.model})`, available: true, detail: `${cfg.source} → ${cfg.baseUrl}`}
    : {
        name: 'LLM director',
        available: false,
        detail: 'set OPENAI_API_KEY (any OpenAI-compatible endpoint) or LLM_API_KEY + LLM_BASE_URL to enable',
      };
}

/** Brief → planner context fallback used by CLI callers that only have a prompt. */
export type {Brief};
