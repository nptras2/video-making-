# AI Video Production Engine

One reusable engine that takes **whatever material you have** — video, audio, images, a script, a prompt, or any combination — and produces a finished, edited video: talking-head reels, YouTube edits, explainers, 2D animated stories, 3D motion graphics, ads, documentaries.

You do not create a project, a composition, a timeline or a scene file. You hand over material and describe the result.

```bash
npm run video -- create --in "C:\footage\interview.mp4" --ratio 9:16 --prompt "a tight reel about hiring mistakes"
```

```bash
npm run video -- create --in narration.mp3 --prompt "how a black hole bends light"
```

```bash
npm run video -- create --script script.txt --style 3d-motion
```

That is the whole workflow. Everything below is optional control.

---

## What actually happens

```
INPUT → UNDERSTAND → PLAN → STORYBOARD → ASSETS → TIMELINE → MOTION →
AUDIO → CAPTIONS → RENDER → MUX → QC → OUTPUT
```

1. **Understand** — every input is probed (duration, resolution, streams) and classified. Speech is transcribed locally with whisper.cpp. Silence is measured. Text is read.
2. **Plan** — a `VideoPlan` (the single source of truth) is generated: format, duration, style, ordered scenes, camera moves, layers, text, audio tracks, captions. An optional LLM director can write this plan; otherwise a deterministic local planner does.
3. **Storyboard** — the plan is rendered as human-readable `STORYBOARD.md` (scene number, time, narration, visual, camera, animation, text, transition, audio).
4. **Assets** — stock B-roll (if keyed), generated imagery (if keyed), offline-synthesised music and SFX, supplied media. Missing capabilities degrade to procedural scenes instead of failing.
5. **Edit** — silence-based cuts, frame-accurate trimming, reframing, B-roll placement by keyword.
6. **Compose** — Remotion renders the timeline (2D parallax animation, 3D motion graphics, real footage, typography, captions, grade).
7. **Audio** — FFmpeg builds the master mix: narration, music ducked underneath by a real sidechain compressor, loudness-normalised, exact length.
8. **QC** — the rendered file is measured against the plan (resolution, duration, frame rate, timeline continuity, caption coverage, black frames, exposure, audio level, dead air) and written up as `qc-report.md`.

Remotion renders *picture*; FFmpeg owns *audio* and *editing*. That split keeps cuts and ducking frame-exact and the whole run reproducible.

---

## Quick start

```bash
npm install                                   # once
npm run video -- doctor                       # see what this machine can do
npx tsx scripts/make-test-assets.ts           # optional: build the demo fixtures
npm run video -- create --in input/           # put your files in ./input first
```

Outputs land in `projects/<name>-<id>/`:

```
projects/test1-talking-head-952520/
├── video-plan.json        the authoritative timeline (inspectable, re-renderable)
├── storyboard.md          the human-readable shot list
├── transcript.json        words + timestamps + provider
├── PROJECT_STATE.json     brief, inputs, providers, revision history
├── public/                media staged for the render
├── work/                  intermediates (extracted audio, cuts, mix)
└── output/
    ├── final.mp4          the delivered video
    ├── thumbnail.jpg
    ├── captions.srt       + captions.vtt + transcript.txt
    ├── audio-mix.wav      the master mix, exactly as muxed
    └── qc-report.md       measured verdict
```

A run is never a dead end: the plan is on disk, so `video render` re-renders it and `video revise` changes it without re-ingesting anything.

---

## Choosing a mode

The input analyzer picks the mode from your material — the brief never overrides it.

| You provide | Mode | What it does |
|---|---|---|
| Video **with** speech | A — talking head | transcribe → remove dead air → punch-ins → B-roll on keywords → captions |
| Video **without** audio | B — video only | uses the footage, with your script as voiceover/instructions |
| **Audio only** | C — narration | transcribe → topic breaks → a scene per beat (2D/3D/procedural) → sync |
| **Script only** | D — script | beats → storyboard → local TTS narration → animated scenes |
| **Prompt only** | E — concept | LLM drafts a script (if keyed) → full production; without an LLM, a typographic motion piece from your prompt — no invented narration |
| **Images + script** | F — stills | stills animated with camera moves, parallax and typography |
| Any mix | G — mixed | routed by what can carry the edit |

Full per-mode detail: [VIDEO_WORKFLOW.md](VIDEO_WORKFLOW.md).

---

## What works with no keys at all

Verified in this repository, on a machine with no API keys:

| Capability | Local implementation |
|---|---|
| Speech → text (word timings) | whisper.cpp, installed and run locally |
| Narration voice | Windows System.Speech (offline) |
| Music bed + sound design | FFmpeg-synthesised chord progressions and SFX |
| Editing, reframing, grading, mixing | FFmpeg |
| 2D animation | procedural parallax scenes, drawn from plan data |
| 3D motion graphics | React Three Fiber, frame-synchronous via `@remotion/three` |
| Captions | word-level, from the transcript |
| Planning | deterministic local planner |

Keys only *add* capability. See [PROVIDERS.md](PROVIDERS.md) for the full matrix and [SETUP.md](SETUP.md) to configure.

---

## Commands

```bash
npm run video -- create    # produce a video
npm run video -- revise    # change a finished project
npm run video -- render    # re-render the saved plan
npm run video -- storyboard <project>
npm run video -- plan <project>
npm run video -- list
npm run video -- doctor
```

Shortcuts: `npm run create`, `npm run doctor`, `npm run list`. Or `npm link` once and use plain `video create`.
Full reference: [COMMANDS.md](COMMANDS.md).

---

## Documentation

| File | Contents |
|---|---|
| [SETUP.md](SETUP.md) | requirements, install, optional keys, verification |
| [ARCHITECTURE.md](ARCHITECTURE.md) | modules, data flow, the plan schema, design rules |
| [PROVIDERS.md](PROVIDERS.md) | every provider, env var, local fallback |
| [STYLES.md](STYLES.md) | the 11 styles, their tokens, how to add one |
| [VIDEO_WORKFLOW.md](VIDEO_WORKFLOW.md) | modes A–G end to end |
| [COMMANDS.md](COMMANDS.md) | every CLI flag |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | real failure modes and fixes |

---

## Honest limitations

- **AI video generation needs a paid key** (Luma / Runway / Replicate). Without one you get camera moves over stills, procedural animation and FFmpeg editing — all real, none of it "generated footage".
- **Local TTS is a system voice**, not a studio voice. For broadcast quality, set `ELEVENLABS_API_KEY`.
- **Synthesised music is tonal ambience**, not a licensed soundtrack. The planner labels it as such.
- **whisper.cpp `base` word timings drift** by a few hundred milliseconds. Captions stay in order and never lose words, but for tight sync set `WHISPER_MODEL=small`.
- **Stock B-roll requires a key.** No key means no stock fetching — it is reported, not faked.
