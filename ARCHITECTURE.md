# ARCHITECTURE

## The one idea

There is **no per-video code**. A production is data: one `VideoPlan` describing format, scenes, motion, audio and captions. The Remotion composition is a thin host that dispatches each scene object to a registered scene component. A new video type is a *new plan*, not a new project.

```
                        ┌──────────────┐
  inputs ──► analyzer ─►│  VIDEO_PLAN  │─► VideoHost ─► scene registry ─► renderer
  brief  ──► planner  ──└──────┬───────┘        │
                               │                ├─► caption layer
                        storyboard.md            ├─► graphic overlays
                        captions.srt             └─► grade
                        qc-report.md
```

## Layers

```
engine/                  deterministic core (no React)
  types.ts               the data model: VideoPlan, Scene, AudioTrack, CaptionTrack
  input/analyzer.ts      input → InputDescriptor[] + InputMode (A–G)
  media/ffmpeg.ts        probe, extract, cut, concat, reframe, mix, thumbnail, scans
  editor/cuts.ts         silence → keep-list; chunking; word remap onto the edited timeline
  planner/visuals.ts     keyword → visual recipe lexicon + style archetypes
  planner/local.ts       deterministic planner for every mode; brief parsing
  ai/index.ts            LLM director: propose plan → schema-validate → sanitise
  ai/director.ts         LLM script drafting for prompt-only jobs
  captions/index.ts      word cues → readable phrase cues → SRT / VTT
  qc/index.ts            measure the render against the plan
  storyboard/index.ts    plan → STORYBOARD.md
  project/manager.ts     project layout, PROJECT_STATE.json, asset staging
  render/render.ts       bundle (per-project publicDir) + renderMedia/renderStill
  pipeline.ts            the orchestrator (create / revise / re-render)

components/              the Remotion composition surface
  VideoHost.tsx          plan → <Sequence> list, transitions, layer order
  scenes/registry.ts     sceneType → component (the plugin surface)
  scenes/*.tsx           clip, image, title, card, two-d, three-d, abstract
  lib/ParallaxStack.tsx  2.5D depth plates
  lib/SceneText.tsx      typography
  lib/anim.ts            frame math, easing, deterministic PRNG, camera transforms
  captions/CaptionLayer.tsx   word-level karaoke captions
  overlays/GraphicOverlay.tsx lower thirds, stats, callouts
  Grade.tsx              vignette, grain, tint

providers/               capability adapters, each with an honest fallback
  stt/ voice/ image/ video/ media/ music/  + index.ts (capability report)

styles/tokens.ts         style tokens (colour, type, motion, caption, grade)
cli/index.ts             the `video` command
```

## Data flow of one production

| Step | Module | Output |
|---|---|---|
| 1 inputs | `pipeline.resolveInputs` | concrete file paths (dirs expanded) |
| 2 analyze | `analyzer.analyzeInputs` | descriptors, quality flags, `InputMode` |
| 3 providers | `capabilityReport` | what is local / API / missing |
| 4 project | `project/initProject` | `projects/<slug>/`, `PROJECT_STATE.json` |
| 5 ingest | `project/stageAsset` | media copied into `public/` for `staticFile()` |
| 6 understand | `stt` + `editor/cuts` | words, segments, keep-list, cut video + wav |
| 7 voice | `voice.speak` per beat | staged narration clips + real durations |
| 8 B-roll | `media.searchStock` | keyword-matched stock clips (when keyed) |
| 9 plan | `ai.planVideoSmart` → `planner/local` fallback | `VideoPlan`, written to `video-plan.json` |
| 10 assets | `music.synthesizeBed`, `image.generate` | music bed, generated plates |
| 11 storyboard | `storyboard.renderStoryboard` | `storyboard.md` |
| 12 captions | `captions.toSrt/toVtt` | `captions.srt`, `captions.vtt` |
| 13 mix | `media.mixAudio` | `audio-mix.wav` (ducked, loudness-normalised) |
| 14 render | `render.renderPlan` | `work/picture.mp4` (muted, exact frames) |
| 15 mux | `media.muxAudio` | `output/final.mp4` |
| 16 QC | `qc.runQc` | `qc-report.md` |

## Why Remotion renders picture and FFmpeg owns sound

Remotion is excellent at frame-accurate composition and poor at being trusted for timeline-exact audio after editorial cuts. So:

- **Picture** comes from Remotion with `muted: true`. Scene timing, cuts and reframes are frame-exact.
- **Sound** is assembled by FFmpeg from the exact same timings (`plan.audio`), with real sidechain compression for music ducking and EBU-style loudness normalisation.
- The two are muxed at the end. `audio-mix.wav` is kept beside the output so the mix can be inspected and remixed without a re-render.

This is also why a talking-head cut is performed by FFmpeg *before* planning: the cut video and its WAV stay in sync by construction, and Remotion only ever plays already-cut footage.

## The `VideoPlan`

`video-plan.json` is the contract between planning and rendering. Abridged:

```jsonc
{
  "version": 1,
  "title": "Cut The Dead Air",
  "format": { "ratio": "9:16", "width": 1080, "height": 1920, "fps": 30 },
  "duration": 23.06,
  "style": "reels",
  "scenes": [
    {
      "id": "s01",
      "type": "clip",                 // clip | image | title | card | two-d | three-d | abstract
      "track": "base",                // or "overlay" (B-roll)
      "start": 0, "duration": 3.31,
      "purpose": "hook",
      "camera": "push-in",
      "src": "source.mp4",            // staged file, resolved via staticFile()
      "data": { "trimBeforeSec": 0, "punchIn": 1.07 }
    }
  ],
  "audio": [
    { "id": "source", "src": "source.wav", "role": "source",   "start": 0, "volume": 1 },
    { "id": "music",  "src": "music-bed.wav", "role": "music", "start": 0, "volume": 0.32, "duck": true }
  ],
  "captions": { "cues": [ /* word-level */ ], "style": { "mode": "word" } },
  "defaultTransition": { "type": "slide", "duration": 0.25 }
}
```

Design rules encoded in the type:

- **`track: 'overlay'`** puts a scene above the base track (B-roll), so a talking head keeps running underneath.
- **`data`** is the scene-type plugin payload (`trimBeforeSec`, `punchIn`, `shape`, `variant`, `effects`, `beam`…). New scene types add keys, not schema changes.
- **Audio is separate from scenes** — editorial cuts and mixing are decoupled from composition.
- **Timestamped captions** are derived from the transcript, never hard-coded.

## Scene registry — the extension point

```ts
// components/scenes/registry.ts
export const registry: Record<SceneType, SceneComponent> = {
  clip: ClipScene, image: ImageScene, title: TitleScene, card: CardScene,
  abstract: AbstractScene, 'two-d': TwoDScene, 'three-d': ThreeDScene,
};
```

Adding a scene type is: write a component with the `SceneComponentProps` signature, add one line here, emit the type from a planner. Nothing else changes — `VideoHost` resolves types through this map.

## Determinism

Everything respects two rules:

1. **Frame-based animation only.** `useCurrentFrame()` + `interpolate`/`spring` and plain math. No CSS keyframes or transitions — those are unreliable during headless capture.
2. **Deterministic randomness.** Every particle, star, firefly and orbit uses a seeded PRNG (`mulberry32`, `rand01`) derived from an index — never `Math.random()`. Frame *N* renders identically on every run.

Same plan ⇒ same video.

## Failure philosophy

A missing capability must never be a crash and must never be faked:

- providers report `available: false` with the reason, instead of throwing;
- the planner has a local path for every mode, so an absent LLM always yields a plan;
- stock search errors are collected per provider, not raised;
- an LLM plan is schema-validated and sanitised (sequential timeline, known scene types, staged assets only) before rendering — an invalid proposal falls back to the local planner and says so;
- QC never "fixes" anything. It measures and reports `pass` / `warn` / `fail` per check.

## Revisions

`PROJECT_STATE.json` records the brief, inputs, provider set and a revision log. Because all media is already staged and the plan is on disk:

- `video render <project>` re-renders the saved plan — the fast iteration loop;
- `video revise <project> --note "…"` re-plans with a brief patch and renders again.

No re-transcription, no re-ingest, no rebuilt project.
