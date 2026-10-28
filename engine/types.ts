/**
 * Core data model for the video production engine.
 *
 * A VideoPlan is the single source of truth that flows from the planner →
 * storyboard → timeline → Remotion composition → renderer. Everything is
 * data-driven: the composition is a thin host that dispatches scene objects
 * to registered scene components, so new scene types are added by registering
 * a component, never by editing a giant hardcoded template.
 */

export type Ratio = '16:9' | '9:16' | '1:1' | '4:5' | 'custom';

export interface FormatSpec {
  ratio: Ratio;
  width: number;
  height: number;
  fps: number;
  /** Optional custom encode settings */
  bitrate?: number;
}

export type SceneType =
  | 'clip' // source video footage (cut / B-roll / talking head)
  | 'image' // still image with camera move (Ken Burns / parallax)
  | 'title' // title card / animated typography
  | 'card' // location / time / label card
  | 'two-d' // 2D illustrated animated scene
  | 'three-d' // 3D motion graphics scene
  | 'abstract' // procedural visuals (audio-driven fallback)

export type CameraMove =
  | 'static'
  | 'push-in'
  | 'pull-out'
  | 'pan-left'
  | 'pan-right'
  | 'pan-up'
  | 'pan-down';

export interface TextSpec {
  text: string;
  /** 'title' | 'subtitle' | 'callout' | 'stat' etc. */
  role?: string;
  /** normalized 0..1 position; defaults chosen by role */
  x?: number;
  y?: number;
  size?: number; // px at 1080p-height reference; scaled by composition height
  color?: string;
  emphasis?: string[]; // words to highlight (captions/kinetic type)
}

/** A layered 2.5D depth plate used by two-d scenes */
export interface LayerSpec {
  /** Named preset rendered procedurally: sky | stars | mountains | sea | city | field | room | fog */
  asset: string;
  depth: number; // 0 (far) .. 1 (near) — drives parallax displacement
  color?: string;
  offset?: { x: number; y: number };
}

export interface SceneTransition {
  type: 'fade' | 'dissolve' | 'slide' | 'none';
  duration: number; // seconds
}

export interface Scene {
  id: string;
  type: SceneType;
  /** 'base' = sequential main track, 'overlay' = sits on top (B-roll etc.) */
  track?: 'base' | 'overlay';
  /** timeline position in seconds */
  start: number;
  duration: number;
  /** why this scene exists: hook | setup | evidence | payoff | outro */
  purpose?: string;
  /** spoken words for this scene (drives captions + VO) */
  narration?: string;
  /** natural-language description of what is shown */
  visual?: string;
  /** media file path, relative to the project's asset staging dir */
  src?: string;
  camera?: CameraMove;
  layers?: LayerSpec[];
  text?: TextSpec[];
  /** named animation preset, e.g. 'beam-rotate', 'orbit', 'reveal' */
  animation?: string;
  transitionIn?: SceneTransition;
  /* ---- AI Director decisions (see engine/director) -------------------------
   * These are creative decisions, not timing: the planner owns start/duration,
   * the director owns what is shown, how it is shot, and how it is lit. They are
   * written into the plan so the storyboard, the UI and the renderers all agree.
   */
  /** shot size / framing, e.g. 'wide establishing', 'medium', 'close-up' */
  shot?: string;
  /** lighting description, e.g. 'golden hour backlight', 'high-key studio' */
  lighting?: string;
  /** where/when this happens, e.g. 'rain-soaked street, pre-dawn' */
  environment?: string;
  /** character identity ids present in this scene (see characters.json) */
  characters?: string[];
  /** what actually moves in frame, e.g. 'crowd drifts, signage flickers' */
  motion?: string;
  /** the spoken moment this visual must land on, e.g. '"three reasons" → numbered cards' */
  audioSync?: string;
  /** words worth emphasizing visually when spoken */
  emphasis?: string[];
  /** scene-type specific payload (3D shapes, chart data, particles…) */
  data?: Record<string, unknown>;
  /** produced by the optional Blender renderer; Remotion uses it as an image-sequence video */
  renderBackend?: 'remotion' | 'blender';
}

export type AudioRole = 'voiceover' | 'music' | 'sfx' | 'ambience' | 'source';

export interface AudioTrackSpec {
  id: string;
  src: string; // relative to project asset dir
  role: AudioRole;
  start: number; // seconds on timeline
  duration?: number;
  volume?: number; // 0..1 base gain
  /** music gets ducked under narration */
  duck?: boolean;
}

export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface CaptionCue {
  text: string;
  startMs: number;
  endMs: number;
  /** word-level timing (from STT) enabling karaoke highlighting */
  words?: CaptionWord[];
}

export type CaptionMode = 'phrase' | 'word' | 'sentence';

export interface CaptionStyle {
  mode: CaptionMode;
  font?: string;
  color?: string;
  highlightColor?: string;
  background?: string;
  stroke?: string;
  /** 0..1 from top (0.5 = centered lower third) */
  position?: number;
  uppercase?: boolean;
  size?: number; // px reference at 1080 height
}

export interface CaptionTrack {
  cues: CaptionCue[];
  style: CaptionStyle;
}

/** Overlay graphics that float above scenes (lower thirds, callouts, stats) */
export interface OverlaySpec {
  id: string;
  kind: 'lower-third' | 'callout' | 'stat' | 'logo' | 'progress';
  start: number;
  duration: number;
  title?: string;
  subtitle?: string;
  value?: string;
  src?: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
}

export interface VideoPlan {
  version: 1;
  /** Persistent, inspectable output from the AI Director. */
  director?: {
    kind: string;
    mood: string;
    act: string;
    topics: string[];
    keyPhrases: string[];
    setting: {place?: string; interior: boolean; timeOfDay: string; weather: string};
    characters: Array<{id: string; name: string; role: string; descriptors: string[]; mentions: number; firstBeat: number}>;
    story: Array<{index: number; text: string; purpose: string; topic: string; mood: string; characters: string[]}>;
    narrative: boolean;
    hasNumbers: boolean;
    method: 'deterministic-local' | 'llm-assisted';
  };
  title?: string;
  format: FormatSpec;
  /** total duration in seconds */
  duration: number;
  /** style name resolved against styles/<name>.md + style tokens */
  style: string;
  scenes: Scene[];
  audio: AudioTrackSpec[];
  captions?: CaptionTrack;
  overlays?: OverlaySpec[];
  /** default transition applied between scenes when not specified */
  defaultTransition?: SceneTransition;
}

/** Provider capabilities actually available in this environment */
export interface ProviderStatus {
  name: string;
  kind: 'stt' | 'tts' | 'image' | 'video' | 'music' | 'planner';
  available: boolean;
  mode: 'local' | 'api' | 'unavailable';
  detail: string;
}

export interface InputDescriptor {
  path: string;
  kind: 'video' | 'audio' | 'image' | 'text' | 'unknown';
  duration?: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  sizeBytes: number;
  detail?: string;
}

export interface RevisionEntry {
  n: number;
  note: string;
  at: string;
}

export interface ProjectState {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  brief: Record<string, unknown>;
  inputs: InputDescriptor[];
  style: string;
  format: FormatSpec;
  providers: ProviderStatus[];
  files: Record<string, string>;
  revisions: RevisionEntry[];
  notes: string[];
}

export const RATIO_PRESETS: Record<Exclude<Ratio, 'custom'>, {width: number; height: number}> = {
  '16:9': {width: 1920, height: 1080},
  '9:16': {width: 1080, height: 1920},
  '1:1': {width: 1080, height: 1080},
  '4:5': {width: 1080, height: 1350},
};

export const DEFAULT_FPS = 30;

export function resolveFormat(ratio: Ratio, fps = DEFAULT_FPS, custom?: {width: number; height: number}): FormatSpec {
  if (ratio === 'custom') {
    if (!custom) throw new Error('format "custom" requires explicit width/height');
    return {ratio, width: custom.width, height: custom.height, fps};
  }
  const preset = RATIO_PRESETS[ratio];
  return {ratio, width: preset.width, height: preset.height, fps};
}