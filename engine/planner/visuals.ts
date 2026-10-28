/**
 * Visual recipe lexicon — the planner's "director's eye".
 *
 * Maps narration/script keywords to concrete visual recipes (layer stacks,
 * scene types, effects, camera moves) so B-roll and animated scenes *support
 * the words* instead of being random decoration. Purely deterministic: same
 * input ⇒ same creative decision.
 */
import type {CameraMove, LayerSpec, Scene, SceneType} from '../types';

export interface VisualRecipe {
  /** preferred scene type for body scenes in this topic */
  sceneType: SceneType;
  layers?: LayerSpec[];
  effects?: 'fireflies' | 'rain' | 'snow' | 'none';
  beam?: {x: number; y: number};
  camera?: CameraMove;
  /** three-d knobs when sceneType is three-d */
  data?: Record<string, unknown>;
  /** palette overrides applied to scene text */
  mood: 'calm' | 'tense' | 'upbeat' | 'serious' | 'wonder';
}

const recipe = (r: Partial<VisualRecipe> & {sceneType: SceneType}): VisualRecipe => ({
  effects: 'none',
  camera: 'push-in',
  mood: 'calm',
  ...r,
});

interface Rule {
  keywords: string[];
  recipe: VisualRecipe;
}

/** Order matters: first match wins (more specific topics first). */
const RULES: Rule[] = [
  {
    keywords: ['black hole', 'galaxy', 'planet', 'cosmos', 'universe', 'orbit', 'nebula', 'star', 'space', 'satellite', 'gravity'],
    recipe: recipe({
      sceneType: 'two-d',
      layers: [
        {asset: 'sky', depth: 0, color: '#060a1c'},
        {asset: 'stars', depth: 0.06},
        {asset: 'moon', depth: 0.14, color: '#cfd8ff'},
        {asset: 'fog', depth: 0.4, color: 'rgba(90,120,220,0.14)'},
      ],
      camera: 'push-in',
      mood: 'wonder',
    }),
  },
  {
    keywords: ['ocean', 'sea', 'lighthouse', 'wave', 'storm', 'harbor', 'coast', 'ship', 'night', 'beacon'],
    recipe: recipe({
      sceneType: 'two-d',
      layers: [
        {asset: 'sky', depth: 0, color: '#0b1730'},
        {asset: 'stars', depth: 0.05},
        {asset: 'moon', depth: 0.12},
        {asset: 'sea', depth: 0.42},
        {asset: 'field', depth: 0.8, color: '#070f14'},
      ],
      beam: {x: 0.68, y: 0.34},
      effects: 'fireflies',
      camera: 'pan-right',
      mood: 'calm',
    }),
  },
  {
    keywords: ['city', 'urban', 'traffic', 'street', 'downtown', 'skyline', 'building'],
    recipe: recipe({
      sceneType: 'two-d',
      layers: [
        {asset: 'sky', depth: 0, color: '#101a33'},
        {asset: 'fog', depth: 0.3, color: 'rgba(150,170,210,0.12)'},
        {asset: 'city', depth: 0.6, color: '#0a1020'},
        {asset: 'city', depth: 0.85, color: '#050810'},
      ],
      camera: 'pan-left',
      mood: 'serious',
    }),
  },
  {
    keywords: ['mountain', 'forest', 'nature', 'valley', 'trail', 'hike', 'river', 'tree'],
    recipe: recipe({
      sceneType: 'two-d',
      layers: [
        {asset: 'sky', depth: 0, color: '#14243c'},
        {asset: 'moon', depth: 0.1, color: '#f2ead8'},
        {asset: 'mountains', depth: 0.45, color: '#0d1626'},
        {asset: 'mountains', depth: 0.7, color: '#070d18'},
        {asset: 'field', depth: 0.9, color: '#08110d'},
      ],
      effects: 'fireflies',
      camera: 'pan-right',
      mood: 'calm',
    }),
  },
  {
    keywords: ['snow', 'winter', 'ice', 'frost', 'arctic'],
    recipe: recipe({
      sceneType: 'two-d',
      layers: [
        {asset: 'sky', depth: 0, color: '#182436'},
        {asset: 'mountains', depth: 0.5, color: '#101a2a'},
        {asset: 'field', depth: 0.85, color: '#1b2636'},
      ],
      effects: 'snow',
      mood: 'calm',
    }),
  },
  {
    keywords: ['market', 'stock', 'economy', 'gdp', 'percent', 'billion', 'million', 'growth', 'chart', 'data', 'statistics', 'population', 'revenue', 'budget'],
    recipe: recipe({
      sceneType: 'abstract',
      data: {variant: 'bars', bars: [0.45, 0.72, 0.58, 0.9, 0.76]},
      camera: 'push-in',
      mood: 'serious',
    }),
  },
  {
    keywords: ['ai', 'artificial intelligence', 'software', 'code', 'algorithm', 'network', 'cloud', 'chip', 'server', 'robot', 'technology', 'startup', 'product'],
    recipe: recipe({
      sceneType: 'three-d',
      data: {shape: 'icosahedron', count: 14, spread: 3.6, glow: true, variant: 'orbit'},
      camera: 'push-in',
      mood: 'upbeat',
    }),
  },
  {
      keywords: ['home', 'family', 'kitchen', 'room', 'child', 'mother', 'father', 'memory', 'letter', 'walk', 'journey', 'travelling', 'traveling', 'lonely', 'abroad', 'misses'],
    recipe: recipe({
      sceneType: 'two-d',
      layers: [
        {asset: 'sky', depth: 0, color: '#263650'},
        {asset: 'moon', depth: 0.13, color: '#f5dca0'},
        {asset: 'city', depth: 0.48, color: '#263044'},
        {asset: 'road', depth: 0.74, color: '#171c29'},
        {asset: 'field', depth: 0.9, color: '#0d141c'},
      ],
      effects: 'none',
      mood: 'calm',
      camera: 'pan-right',
      data: {character: {x: 0.36, y: 0.14, scale: 1.05, tone: 'flat', action: 'walk', coat: '#293246', skin: '#bb8464', identity: 'protagonist-01'}},
    }),
  },
  {
    keywords: ['rain', 'grief', 'loss', 'fear', 'haunt', 'ghost', 'dark', 'whisper', 'shadow', 'midnight'],
    recipe: recipe({
      sceneType: 'two-d',
      layers: [
        {asset: 'sky', depth: 0, color: '#07070c'},
        {asset: 'mountains', depth: 0.5, color: '#0a0a10'},
        {asset: 'field', depth: 0.85, color: '#05050a'},
      ],
      effects: 'rain',
      camera: 'push-in',
      mood: 'tense',
    }),
  },
  {
    keywords: ['health', 'doctor', 'brain', 'mind', 'habit', 'focus', 'sleep', 'stress', 'body'],
    recipe: recipe({
      sceneType: 'abstract',
      data: {variant: 'pulse'},
      mood: 'serious',
    }),
  },
];

const DEFAULT_RECIPE: VisualRecipe = recipe({
  sceneType: 'abstract',
  data: {variant: 'drift'},
  mood: 'calm',
});

/** Score each rule by keyword hits; pick the strongest match. */
export function matchRecipe(text: string): VisualRecipe {
  const hay = text.toLowerCase();
  let best: VisualRecipe = DEFAULT_RECIPE;
  let bestScore = 0;
  for (const rule of RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (hay.includes(kw)) score += kw.includes(' ') ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = rule.recipe;
    }
  }
  return bestScore > 0 ? best : DEFAULT_RECIPE;
}

/** Keyword → asset filename relevance for B-roll placement. */
export function relevanceScore(segmentText: string, assetName: string): number {
  const words = assetName
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  const hay = segmentText.toLowerCase();
  let hits = 0;
  for (const w of words) if (hay.includes(w)) hits++;
  return hits;
}

/* --------------------------- style archetypes --------------------------- */

/**
 * An explicit `--style` is a production instruction, not a hint: asking for
 * "3d-motion" must produce 3D motion graphics even when the narration's
 * keywords would have chosen something else. These archetypes let the keyword
 * lexicon drive *art direction* (mood, camera, palette) while the requested
 * style drives the *scene technology*.
 */
export type Archetype = 'three-d' | 'two-d' | 'abstract';

export function styleArchetype(style?: string): Archetype | null {
  switch (style) {
    case '3d-motion':
      return 'three-d';
    case '2d-animation':
    case 'horror-story':
      return 'two-d';
    default:
      return null;
  }
}

/**
 * Deterministic parallax stack used when a 2D style has no matched recipe.
 *
 * It deliberately includes a moon: a stack of only dark silhouette plates
 * renders as a near-black scene (measured average luma 11-17/255), which is a
 * real quality defect — every other stack carries a light source (a moon, a
 * beam, city glow) so the frame reads as a night scene rather than an
 * empty screen.
 */
const DEFAULT_PARALLAX: LayerSpec[] = [
  {asset: 'sky', depth: 0, color: '#1b2a47'},
  {asset: 'stars', depth: 0.06},
  {asset: 'moon', depth: 0.12, color: '#eef3ff'},
  {asset: 'mountains', depth: 0.45, color: '#131f36'},
  {asset: 'mountains', depth: 0.72, color: '#0a1120'},
  {asset: 'field', depth: 0.9, color: '#0d1a17'},
];

/** Varied 3D setups so a multi-scene piece has visual progression, not repetition. */
const THREE_D_SETUPS: Array<Record<string, unknown>> = [
  {shape: 'icosahedron', variant: 'orbit', count: 14, spread: 3.6, glow: true},
  {shape: 'box', variant: 'grid', count: 20, spread: 4.2, glow: true},
  {shape: 'torus', variant: 'explode', count: 16, spread: 3.2, glow: true},
  {shape: 'octahedron', variant: 'orbit', count: 10, spread: 2.8, glow: true},
];

const ABSTRACT_SETUPS: Array<Record<string, unknown>> = [
  {variant: 'bars', bars: [0.45, 0.72, 0.58, 0.9, 0.76]},
  {variant: 'pulse'},
  {variant: 'drift'},
  {variant: 'bars', bars: [0.3, 0.55, 0.85, 0.62, 0.95, 0.4]},
];

/** Force a recipe onto the requested style's scene technology. */
export function applyArchetype(r: VisualRecipe, archetype: Archetype, index: number): VisualRecipe {
  if (archetype === 'three-d') {
    return {
      ...r,
      sceneType: 'three-d',
      layers: undefined,
      beam: undefined,
      effects: 'none',
      data: {...(r.data ?? {}), ...THREE_D_SETUPS[index % THREE_D_SETUPS.length]},
    };
  }
  if (archetype === 'two-d') {
    return {
      ...r,
      sceneType: 'two-d',
      layers: r.layers && r.layers.length > 0 ? r.layers : DEFAULT_PARALLAX,
      data: {...(r.data ?? {}), effects: r.effects ?? 'none'},
    };
  }
  return {
    ...r,
    sceneType: 'abstract',
    layers: undefined,
    beam: undefined,
    data: {...(r.data ?? {}), ...ABSTRACT_SETUPS[index % ABSTRACT_SETUPS.length]},
  };
}

/** Resolve a beat's recipe, honouring an explicit style archetype when given. */
export function recipeFor(text: string, explicitStyle: string | undefined, index: number): VisualRecipe {
  const base = matchRecipe(text);
  const archetype = styleArchetype(explicitStyle);
  return archetype ? applyArchetype(base, archetype, index) : base;
}

/** Build a scene object from a recipe (shared by all planner paths). */
export function recipeScene(base: Scene, r: VisualRecipe): Scene {
  return {
    ...base,
    type: r.sceneType,
    camera: base.camera ?? r.camera,
    layers: r.sceneType === 'two-d' ? r.layers : base.layers,
    data: {
      ...(r.data ?? {}),
      ...(base.type === 'two-d' ? {effects: r.effects ?? 'none', ...(r.beam ? {beam: r.beam} : {})} : {}),
      ...(base.data ?? {}),
    },
  };
}