# PROVIDERS

Every external capability sits behind an adapter that reports honestly whether it is available. Nothing here is required: the engine is designed to produce a finished video with **zero keys**, and to state clearly what it did and did not have.

`npm run video -- doctor` prints this table for your machine.

Legend: `◆` api-backed · `●` local/offline · `○` unavailable (with fallback)

---

## Speech to text

| Provider | Requires | Mode |
|---|---|---|
| **whisper.cpp** (default) | nothing — installs its binary + `base` model into `node_modules/.whisper/` on first use | `●` local |
| OpenAI-compatible transcription | `OPENAI_API_KEY` (+ `OPENAI_BASE_URL`) | `◆` api |

- Force one with `STT_PROVIDER=whisper|openai`.
- Model quality via `WHISPER_MODEL=tiny|base|small|medium|large-v3` (default `base`).
- Returns real word-level timings, moves through `speechWords` → `normalizeWords`, and drives editing decisions, captions, keyword B-roll and scene breaks.
- **Fallback when unavailable:** silence-based segmentation only. No captions, no keyword B-roll — recorded as a warning, never silently skipped.

```ts
const {provider, status} = await getSttProvider();
```

---

## Narration (text to speech)

| Provider | Requires | Mode |
|---|---|---|
| ElevenLabs | `ELEVENLABS_API_KEY` (+ `ELEVENLABS_VOICE_ID`) | `◆` api |
| OpenAI TTS | `OPENAI_API_KEY` | `◆` api |
| **Windows System.Speech** | Windows — nothing else | `●` local |

- Order is ElevenLabs → OpenAI → local; override with `TTS_PROVIDER=elevenlabs|openai|local`.
- The local provider is a genuine offline voice, not a placeholder. It is a *system* voice: intelligible, not broadcast grade.
- **Fallback when unavailable:** scenes are timed to an estimated reading pace with no narration audio, and the run says so.

---

## Music and sound design

| Provider | Requires | Mode |
|---|---|---|
| **Local synthesis (FFmpeg)** | nothing | `●` local |
| Jamendo | `JAMENDO_CLIENT_ID` | `◆` api |

Local synthesis is real, offline and deterministic:

- `synthesizeBed({durationSec, mood})` — mood-mapped chord progressions (`calm`, `wonder`, `tense`, `upbeat`, `serious`, `sad`) built from `sine` sources with a slow tremolo, stereo widening, fades and `loudnorm`. Exactly the requested duration.
- `synthesizeSfx(kind)` — `whoosh`, `riser`, `impact`, `click`, `swell`, from filtered noise bursts, frequency sweeps (`aevalsrc`) and decaying low tones.

This is *tonal ambience*, not a licensed soundtrack, and the plan and storyboard label it that way. For real music, supply your own file or set `JAMENDO_CLIENT_ID`.

---

## AI image generation

| Provider | Requires | Mode |
|---|---|---|
| OpenAI Images (`gpt-image-1`) | `OPENAI_API_KEY` | `◆` api |
| Stability AI | `STABILITY_API_KEY` | `◆` api |
| Replicate | `REPLICATE_API_TOKEN` (+ `REPLICATE_IMAGE_MODEL`) | `◆` api |

First available wins. Generated stills are saved into `work/`, staged into `public/`, and then animated for real by the Remotion camera system (Ken Burns push/pan) — a genuine image→video path that needs no video-model key.

**Fallback when unavailable:** procedural 2D parallax scenes and R3F 3D motion graphics, drawn purely from plan data. No fake "generated" image is ever substituted.

---

## AI video generation

| Provider | Requires | Mode |
|---|---|---|
| Luma Dream Machine | `LUMA_API_KEY` | `◆` api |
| Runway | `RUNWAY_API_KEY` (+ `RUNWAY_MODEL`) | `◆` api |
| Replicate | `REPLICATE_API_TOKEN` (+ `REPLICATE_VIDEO_MODEL`) | `◆` api |

Text-to-video and image-to-video (a local still seeds the first frame). Long-running jobs poll until terminal state; failures carry the provider's reason.

This is the one capability that genuinely requires a paid service. **Fallbacks when unavailable** — all real, none pretending to be generated footage:

- camera moves over supplied or generated stills,
- procedural 2D parallax animation,
- R3F 3D motion graphics,
- FFmpeg editing (trim, reframe, grade, concat) of real footage.

---

## Stock media (automatic B-roll)

| Provider | Requires | Media |
|---|---|---|
| Pexels | `PEXELS_API_KEY` | photos + video |
| Pixabay | `PIXABAY_API_KEY` | photos + video |
| Unsplash | `UNSPLASH_ACCESS_KEY` | photos |

- All configured providers are searched in parallel; per-provider errors are collected, never fatal.
- Queries are derived deterministically from narration (`narrationToQuery` strips stopwords and keeps concrete nouns) — no LLM round-trip needed.
- Credits are collected and written into the storyboard's *Asset credits* section.
- **Fallback when unavailable:** only supplied media is used. The run reports that stock fetching was skipped.

---

## LLM director (planning)

| Provider | Requires | Mode |
|---|---|---|
| OpenAI-compatible `chat/completions` | `OPENAI_API_KEY` (+ `OPENAI_BASE_URL`, `VIDEO_LLM_MODEL`) | `◆` api |
| Provider-neutral | `LLM_API_KEY` + `LLM_BASE_URL` | `◆` api |

The LLM **proposes**, it does not render:

1. It receives mode, format, target duration, style, brief, the local asset list and the transcript/script.
2. It must return strict JSON matching the plan schema.
3. The response is extracted (fences tolerated), parsed with zod, then **sanitised**: unknown scene types are mapped onto the registry, scenes are re-sequenced so the base track has no gaps or overlaps, durations are clamped, and any `src` that was never staged is dropped.
4. On any failure — no key, HTTP error, unparseable JSON, schema mismatch, empty result — the deterministic local planner runs instead and the run records why.

It is also used for **script drafting** in prompt-only jobs (`draftNarration`). Without an LLM the engine builds a typographic motion piece from your prompt and explicitly does **not** invent narration.

---

## Writing a new provider

Follow the shape used throughout `providers/`:

```ts
export interface MyProvider {
  status(): ProviderStatus;                 // never throws; reports availability + why
  run(input: Input): Promise<Output>;       // does the real work, or throws a real error
}
```

Then register it in the relevant `*_PROVIDERS` / `get*Provider()` selection list and add it to `providers/index.ts` so `doctor` and `PROJECT_STATE.json` see it. Providers must:

- report `available: false` with an actionable reason rather than throwing from `status()`;
- fail fast and loudly from the actual work with the upstream message intact;
- never fabricate a result to satisfy a caller.
