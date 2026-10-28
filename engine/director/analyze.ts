/**
 * Director — content understanding.
 *
 * Turns raw material (narration, script, prompt) into a structured reading of
 * the content: who is in it, where and when it happens, how it feels, where it
 * sits in the arc, and which phrases deserve visual emphasis.
 *
 * This is the deterministic half of the AI Director. It is lexicon- and
 * rule-based on purpose: it must work with no API key, be reproducible, and be
 * inspectable. The LLM half (engine/director/index.ts) refines these decisions
 * when credentials exist, but never replaces them blindly — its output is
 * schema-validated and merged onto this analysis.
 */

export type TimeOfDay = 'dawn' | 'morning' | 'day' | 'golden-hour' | 'dusk' | 'night';
export type Weather = 'clear' | 'rain' | 'snow' | 'fog' | 'storm';
export type Mood = 'calm' | 'tense' | 'upbeat' | 'serious' | 'wonder' | 'sad' | 'hopeful' | 'epic';
export type ContentKind = 'story' | 'explanation' | 'promotion' | 'instruction' | 'abstract';
export type Act = 'setup' | 'rising' | 'turn' | 'resolution';

export interface Character {
  /** stable identity used across scenes and by the 2D character rig */
  id: string;
  name: string;
  /** narrative function, e.g. protagonist, mother, narrator */
  role: string;
  /** appearance hints carried into rendering (beard, turban, coat, glasses…) */
  descriptors: string[];
  mentions: number;
  /** first index of the sentence that introduced it */
  firstBeat: number;
}

export interface Beat {
  index: number;
  text: string;
  purpose: string;
  topic: string;
  mood: Mood;
  /** character ids referenced in this beat */
  characters: string[];
}

export interface Setting {
  place?: string;
  interior: boolean;
  timeOfDay: TimeOfDay;
  weather: Weather;
}

export interface ContentAnalysis {
  kind: ContentKind;
  beats: Beat[];
  characters: Character[];
  setting: Setting;
  mood: Mood;
  act: Act;
  topics: string[];
  /** phrases worth emphasizing: numbers, superlatives, questions, imperatives */
  keyPhrases: string[];
  hasNumbers: boolean;
  /** true when the text reads as fiction/narrative rather than information */
  narrative: boolean;
}

/* ------------------------------- lexicons ------------------------------- */

const ROLE_NOUNS: Array<[RegExp, string]> = [
  [/\b(man|gentleman|guy|father|dad|husband|boy|son|brother)\b/i, 'male'],
  [/\b(woman|lady|mother|mom|mum|wife|girl|daughter|sister)\b/i, 'female'],
  [/\b(child|kid|baby|toddler)\b/i, 'child'],
  [/\b(people|crowd|everyone|community|villagers|audience|team|family)\b/i, 'group'],
  [/\b(teacher|doctor|engineer|chef|farmer|driver|pilot|nurse|student|editor|designer|founder|ceo)\b/i, 'role'],
  [/\b(anthropomorphic|robot|cat|dog|bird|fox|wolf|horse)\b/i, 'creature'],
];

const DESCRIPTORS: Array<[RegExp, string]> = [
  [/\bpunjabi\b/i, 'punjabi'],
  [/\bturban\b/i, 'turban'],
  [/\bbeard\b/i, 'beard'],
  [/\bmoustache|mustache\b/i, 'moustache'],
  [/\bglasses\b/i, 'glasses'],
  [/\bshawl|sari|saree|dupatta|kurta\b/i, 'traditional dress'],
  [/\bsuit|blazer|tie\b/i, 'formal wear'],
  [/\bcoat|jacket|hoodie\b/i, 'coat'],
  [/\bold(er)?\b/i, 'older'],
  [/\byoung\b/i, 'young'],
  [/\btall|short\b/i, 'distinctive build'],
  [/\blong hair|short hair|curly\b/i, 'distinctive hair'],
];

const PLACE_WORDS: Array<[RegExp, string]> = [
  [/\b(kitchen|living room|bedroom|office|home|house|room|indoors|studio)\b/i, 'interior'],
  [/\b(street|road|city|village|market|field|mountain|ocean|beach|forest|airport|station|sky|space|orbit)\b/i, 'exterior'],
];

const TIME_WORDS: Array<[RegExp, TimeOfDay]> = [
  [/\b(dawn|daybreak|first light|sunrise)\b/i, 'dawn'],
  [/\b(morning|breakfast|early)\b/i, 'morning'],
  [/\b(noon|midday|afternoon|daytime)\b/i, 'day'],
  [/\b(golden hour|sunset|evening|dusk)\b/i, 'golden-hour'],
  [/\b(twilight|nightfall|dusk)\b/i, 'dusk'],
  [/\b(night|midnight|11 pm|dark|moon|stars|sleep)\b/i, 'night'],
];

const WEATHER_WORDS: Array<[RegExp, Weather]> = [
  [/\b(rain|rainy|drizzle|downpour|monsoon)\b/i, 'rain'],
  [/\b(snow|snowy|blizzard|frost)\b/i, 'snow'],
  [/\b(fog|mist|haze|smog)\b/i, 'fog'],
  [/\b(storm|thunder|lightning|hurricane|tempest)\b/i, 'storm'],
];

const MOOD_WORDS: Array<[RegExp, Mood]> = [
  [/\b(afraid|fear|danger|threat|anxious|panic|haunt|whisper|shadow|loss|grief|cry|tears|alone|miss)\b/i, 'sad'],
  [/\b(afraid|fear|danger|threat|anxious|panic|haunt|escape|race|urgent|hurry)\b/i, 'tense'],
  [/\b(happy|joy|celebrate|laugh|win|winning|amazing|wonderful|delight|party|fun)\b/i, 'upbeat'],
  [/\b(hope|dream|believe|possible|begin|rise|grow|future|change|again)\b/i, 'hopeful'],
  [/\b(awe|universe|galaxy|infinite|vast|wonder|miracle|cosmos|secret|ancient)\b/i, 'wonder'],
  [/\b(power|conquer|legend|epic|greatness|unstoppable|force|rise up)\b/i, 'epic'],
  [/\b(must|should|rule|law|report|figure|percent|data|research|study|analysis|budget|revenue)\b/i, 'serious'],
];

const STORY_MARKERS =
  /\b(once|ago|then|suddenly|he|she|they|his|her|their|walked|stood|said|felt|remembered|dream)\b/i;
const EXPLAIN_MARKERS = /\b(how|why|because|means|works|process|result|cause|therefore|example|when you)\b/i;
const PROMO_MARKERS = /\b(best|get|buy|our|free|try|today|offer|price|shop|subscribe|download|product|launch)\b/i;
const INSTRUCT_MARKERS = /\b(step|first|then|next|make sure|ensure|do not|don't|click|install|add|mix|bake)\b/i;

/* ------------------------------- helpers ------------------------------- */

export const sentences = (text: string): string[] =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

/** Coarse topic: the dominant noun-ish chunk of a sentence. */
const topicOf = (sentence: string): string => {
  const stop = new Set(
    'a an the and or but if then so of to in on at for with is are was were be been it this that he she they we you i as from by into about what when where which who how not no yes have has had do does did will can could would should'.split(
      ' ',
    ),
  );
  const words = sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  return words.slice(0, 3).join(' ') || 'general';
};

/** Phrases that deserve on-screen emphasis when spoken. */
const findKeyPhrases = (text: string): string[] => {
  const out: string[] = [];
  const re =
    /(\$?\d[\d,.]*\s?(%|percent|billion|million|thousand|seconds|minutes|hours|reasons|steps|things|times)?)|(\b\w+est\b)|(\bnever\b|\balways\b|\bbiggest\b|\bmost\b)|(\?\s*$)/gi;
  for (const s of sentences(text)) {
    const m = s.match(re);
    if (m) {
      const phrase = (m[0] || '').trim();
      if (phrase.length > 1) out.push(phrase.replace(/[.,?]$/, ''));
    }
  }
  return [...new Set(out)].slice(0, 8);
};

const scoreMood = (text: string): Mood => {
  const hay = text.toLowerCase();
  let best: Mood = 'calm';
  let bestScore = 0;
  for (const [re, mood] of MOOD_WORDS) {
    const hits = hay.match(new RegExp(re.source, 'gi'))?.length ?? 0;
    if (hits > bestScore) {
      bestScore = hits;
      best = mood;
    }
  }
  return best;
};

/* ------------------------------ main analysis ------------------------------ */

export function analyzeContent(text: string): ContentAnalysis {
  const clean = (text ?? '').trim();
  const sents = sentences(clean);

  /* characters ---------------------------------------------------------- */
  const characters: Character[] = [];
  const seen = new Map<string, Character>();
  sents.forEach((s, i) => {
    // Proper nouns (capitalised mid-sentence) are treated as named characters.
    const props = s.match(/(?<!^|[.!?]\s)(?<!\s[A-Z][a-z]*\s)(\b[A-Z][a-z]{2,}\b)/g) ?? [];
    const lower = s.toLowerCase();
    const push = (name: string, role: string, descriptors: string[]) => {
      const key = slug(name);
      if (!key || key.length < 3) return;
      const stop = new Set(['the','and','but','for','you','not','when','what','where','which','their','there','then','that','this','they','with','from','have','been','will','more','most','into','over','only','also','after','before','because'].concat(['monday','tuesday','wednesday','thursday','friday','saturday','sunday','january','february','march','april','may','june','july','august','september','october','november','december']));
      if (stop.has(key)) return;
      const existing = seen.get(key);
      if (existing) {
        existing.mentions++;
        for (const d of descriptors) if (!existing.descriptors.includes(d)) existing.descriptors.push(d);
      } else {
        const c: Character = {id: key, name, role, descriptors, mentions: 1, firstBeat: i};
        seen.set(key, c);
        characters.push(c);
      }
    };
    const descriptorWords = new Set(DESCRIPTORS.flatMap(([re]) => (re.source.match(/[a-z]+/gi) ?? []).filter((w) => w.length > 3).map((w) => w.toLowerCase())));
    for (const p of props) if (!descriptorWords.has(p.toLowerCase()) && !['india','punjabi'].includes(p.toLowerCase())) push(p, 'named', []);
    for (const [re, role] of ROLE_NOUNS) {
      if (re.test(s)) {
        const m = lower.match(re);
        const label = m ? m[0] : role;
        const descs = DESCRIPTORS.filter(([dr]) => dr.test(s)).map(([, d]) => d);
        push(label.charAt(0).toUpperCase() + label.slice(1), role, descs);
        break;
      }
    }
  });

  /* beats --------------------------------------------------------------- */
  const overallMood = scoreMood(clean);
  const topics = [...new Set(sents.map(topicOf))].slice(0, 12);
  const beats: Beat[] = sents.map((s, i) => ({
    index: i,
    text: s,
    purpose: '',
    topic: topicOf(s),
    mood: scoreMood(s) === 'calm' ? overallMood : scoreMood(s),
    characters: characters.filter((c) => s.toLowerCase().includes(c.name.toLowerCase().split(' ')[0])).map((c) => c.id),
  }));

  /* arc / purpose ------------------------------------------------------- */
  const n = beats.length;
  beats.forEach((b, i) => {
    const pos = n <= 1 ? 0.5 : i / (n - 1);
    if (i === 0) b.purpose = 'hook';
    else if (i === n - 1 && n > 2) b.purpose = 'outro';
    else if (pos < 0.3) b.purpose = 'setup';
    else if (pos < 0.75) b.purpose = 'development';
    else b.purpose = 'payoff';
  });
  const act: Act = overallMood === 'sad' || overallMood === 'tense' ? 'turn' : n > 4 ? 'rising' : 'setup';

  /* setting ------------------------------------------------------------- */
  const lowerText = clean.toLowerCase();
  let timeOfDay: TimeOfDay = 'day';
  for (const [re, t] of TIME_WORDS) {
    if (re.test(lowerText)) {
      timeOfDay = t;
      break;
    }
  }
  if (timeOfDay === 'day' && (overallMood === 'sad' || overallMood === 'tense')) timeOfDay = 'night';
  if (timeOfDay === 'day' && overallMood === 'wonder') timeOfDay = 'dusk';

  let weather: Weather = 'clear';
  for (const [re, w] of WEATHER_WORDS) {
    if (re.test(lowerText)) {
      weather = w;
      break;
    }
  }
  let interior = false;
  let place: string | undefined;
  for (const [re, label] of PLACE_WORDS) {
    const m = lowerText.match(re);
    if (m) {
      if (label === 'interior') interior = true;
      place = m[0];
      break;
    }
  }

  /* kind ---------------------------------------------------------------- */
  let kind: ContentKind = 'abstract';
  if (STORY_MARKERS.test(clean) && sents.length >= 3) kind = 'story';
  if (EXPLAIN_MARKERS.test(clean)) kind = 'explanation';
  if (INSTRUCT_MARKERS.test(clean)) kind = 'instruction';
  if (PROMO_MARKERS.test(clean)) kind = 'promotion';

  const hasNumbers = /\d/.test(clean);

  return {
    kind,
    beats,
    characters,
    setting: {place, interior, timeOfDay, weather},
    mood: overallMood,
    act,
    topics,
    keyPhrases: findKeyPhrases(clean),
    hasNumbers,
    narrative: kind === 'story',
  };
}
