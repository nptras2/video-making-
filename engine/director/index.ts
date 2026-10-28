/**
 * Deterministic AI Director foundation.
 *
 * This is explicit, inspectable content analysis rather than a claim of model
 * inference. An optional LLM planner may replace/refine the timeline when
 * configured; the local director always derives a reproducible story/shot plan
 * and persists it alongside the VideoPlan.
 */
import type {Scene, VideoPlan} from '../types';
import {analyzeContent, type ContentAnalysis, type Mood} from './analyze';
import {recipeFor} from '../planner/visuals';

export interface DirectorSummary {
  kind: string;
  mood: string;
  act: string;
  topics: string[];
  keyPhrases: string[];
  setting: {place?: string; interior: boolean; timeOfDay: string; weather: string};
  characters: ContentAnalysis['characters'];
  story: Array<{index: number; text: string; purpose: string; topic: string; mood: string; characters: string[]}>;
  narrative: boolean;
  hasNumbers: boolean;
  method: 'deterministic-local' | 'llm-assisted';
}

const MOOD_LIGHT: Record<Mood, string> = {
  calm: 'soft directional light, gentle fill, low contrast',
  tense: 'hard side light, deep shadows, restrained practical highlights',
  upbeat: 'bright key light, clean fill, saturated accents',
  serious: 'neutral controlled key, balanced fill, restrained palette',
  wonder: 'volumetric rim light, cool ambient fill, luminous focal point',
  sad: 'soft low-key practical light, cool shadows, warm focal detail',
  hopeful: 'warm backlight, soft fill, gradual lift in exposure',
  epic: 'strong backlight, dramatic contrast, atmospheric depth',
};

const SHOTS = ['wide establishing shot', 'medium shot', 'close-up', 'over-the-shoulder', 'detail insert'];

const settingLine = (analysis: ContentAnalysis): string => {
  const {place, timeOfDay, weather} = analysis.setting;
  return [place, timeOfDay !== 'day' ? timeOfDay.replace('-', ' ') : undefined, weather !== 'clear' ? weather : undefined]
    .filter(Boolean)
    .join(', ');
};

const beatForScene = (scene: Scene, analysis: ContentAnalysis) => {
  const text = (scene.narration ?? scene.visual ?? '').toLowerCase();
  if (!text) return undefined;
  return analysis.beats
    .map((beat) => ({beat, score: beat.text.toLowerCase().split(/\W+/).filter((word) => word.length > 3 && text.includes(word)).length}))
    .sort((a, b) => b.score - a.score)[0]?.beat;
};

/** Analyze material and apply director decisions to every base scene. */
export function directPlan(plan: VideoPlan, inputText: string, method: DirectorSummary['method'] = 'deterministic-local'): DirectorSummary {
  const analysis = analyzeContent(inputText || plan.title || '');
  const protagonist = analysis.characters.find((character) => character.role !== 'group') ?? analysis.characters[0];
  for (const scene of plan.scenes) {
    if (scene.track === 'overlay') continue;
    const beat = beatForScene(scene, analysis);
    const fraction = scene.start / Math.max(0.01, plan.duration);
    const shotIndex = Math.min(SHOTS.length - 1, Math.floor(fraction * SHOTS.length));
    scene.purpose = scene.purpose ?? beat?.purpose ?? (fraction > 0.82 ? 'resolution' : fraction < 0.2 ? 'hook' : 'development');
    scene.shot = scene.shot ?? (scene.type === 'clip' ? 'source-framed talking-head shot' : SHOTS[shotIndex]);
    scene.lighting = scene.lighting ?? MOOD_LIGHT[beat?.mood ?? analysis.mood];
    scene.environment = scene.environment ?? (scene.visual || settingLine(analysis) || analysis.topics.slice(0, 3).join(', '));
    const matching = beat?.characters ?? [];
    scene.characters = scene.characters?.length ? scene.characters : matching.length ? matching : protagonist ? [protagonist.id] : [];
    const recipe = recipeFor(scene.narration ?? scene.visual ?? '', undefined, Math.round(fraction * 9));
    // The first identified non-group character is the persistent on-screen lead.
    // Beats may mention a family member or location without changing the lead's identity.
    const mainCharacter = protagonist;
    if (scene.type === 'two-d' && (recipe.data?.character || mainCharacter || scene.data?.character)) {
      const rCharacter = (recipe.data?.character ?? {}) as Record<string, unknown>;
      const existingCharacter = (scene.data?.character ?? {}) as Record<string, unknown>;
      const actionText = scene.narration ?? scene.visual ?? '';
      const action = /\b(walk|walks|walking|wander|wanders|travel|travels|journey|run|runs|running|leave|leaves|leaving|cross|crosses|crossing|book|books)\b/i.test(actionText)
        ? 'walk'
        : /\b(talk|talks|talking|say|says|saying|speak|speaks|speaking|call|calls|calling|question|answer)\b/i.test(actionText) && mainCharacter
          ? 'talk'
          : 'idle';
      scene.data = {...(scene.data ?? {}), character: {
        ...rCharacter,
        ...existingCharacter,
        action,
        identity: mainCharacter?.id ?? existingCharacter.identity ?? rCharacter.identity ?? 'protagonist-01',
        descriptors: [...new Set([...(Array.isArray(rCharacter.descriptors) ? rCharacter.descriptors as string[] : []), ...(Array.isArray(existingCharacter.descriptors) ? existingCharacter.descriptors as string[] : []), ...(mainCharacter?.descriptors ?? [])])],
        coat: existingCharacter.coat ?? rCharacter.coat ?? '#293246',
        skin: existingCharacter.skin ?? rCharacter.skin ?? '#bb8464',
        tone: existingCharacter.tone ?? rCharacter.tone ?? 'flat',
        x: existingCharacter.x ?? rCharacter.x ?? 0.46,
        y: existingCharacter.y ?? rCharacter.y ?? 0.24,
      }};
    }
    scene.motion = scene.motion ?? (scene.type === 'two-d'
      ? 'layered parallax; character idle/walk cycle and environmental motion follow scene data'
      : scene.type === 'three-d'
        ? 'frame-deterministic camera and object animation; motion supports the spoken beat'
        : scene.camera === 'static' ? 'restrained motion; preserve source action' : `controlled ${scene.camera ?? 'camera'} move`);
    scene.audioSync = scene.audioSync ?? (scene.narration ? `visual beat synchronized to: ${scene.narration}` : undefined);
    scene.emphasis = scene.emphasis ?? analysis.keyPhrases.filter((phrase) =>
      (scene.narration ?? scene.visual ?? '').toLowerCase().includes(phrase.toLowerCase()),
    );
    scene.transitionIn = scene.transitionIn ?? plan.defaultTransition;
  }
  plan.director = {
    kind: analysis.kind,
    mood: analysis.mood,
    act: analysis.act,
    topics: analysis.topics,
    keyPhrases: analysis.keyPhrases,
    setting: analysis.setting,
    characters: analysis.characters,
    story: analysis.beats,
    narrative: analysis.narrative,
    hasNumbers: analysis.hasNumbers,
    method,
  };
  return plan.director;
}
