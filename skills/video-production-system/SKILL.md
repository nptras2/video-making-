---
name: video-production-system
description: Produce edited videos, 2D animations, 3D motion graphics, reels, explainers, ads and documentary pieces from any material (video, audio, images, script, prompt) using the local AI Video Production Engine. Use when asked to make, edit, cut, caption, storyboard, animate, or render a video, or to turn a script or audio file into a finished film.
version: 1.0.0
---

# AI Video Production System

A reusable engine that turns "here is my material and what I want" into a finished video. It lives in this project and needs no API keys to produce a real result.

## The one command

```bash
npm run video -- create --in <files or folders> [--prompt "…"] [--ratio 9:16] [--style reels]
video create …        # equivalent after `npm link`
```

Put material in `./input` and run `npm run video -- create` with no `--in` at all.

## Always start here

```bash
npm run video -- doctor      # which capabilities are local, api-backed, or missing
```

`◆` api · `●` local · `○` unavailable. Then report the gaps and their fallbacks to the user rather than treating them as failures. Never claim a capability the doctor shows as `○`.

## Choose the mode from the material — not from the brief

| Material | Mode | Result |
|---|---|---|
| video with speech | A | dead air cut, punch-ins, keyword B-roll, captions |
| video, silent | B | footage + script/voiceover |
| audio only | C | a scene per spoken beat (2D/3D/procedural) |
| script file | D | beats → TTS narration → animated scenes |
| prompt only | E | LLM script (if keyed), else a typographic motion piece — never invented narration |
| images + script | F | stills with camera moves and parallax |
| any mix | G | routed by what can carry the edit |

A `--prompt` describes the *output*; it is never treated as the script.

## Rules to follow

1. **Size the request to what was asked.** A caption fix does not need a re-plan; use `video render <project>`.
2. **Never promise what is missing.** If the user asks for AI-generated footage and there is no video-generation key, say so and offer the real alternatives (camera moves on stills, procedural 2D/3D, FFmpeg editing).
3. **Verify with evidence, not vibes.** After a run, read `output/qc-report.md`, and confirm scene types in `video-plan.json` actually match the request (`--style 3d-motion` ⇒ `"type": "three-d"`).
4. **Keep the plan.** `video-plan.json` is written before rendering; a failed render is always recoverable.
5. **Prefer revisions to rebuilds.** `video revise <project> --note "…"` re-plans and re-renders using already-staged media.
6. **Editorial restraint.** Use an effect only where it improves comprehension. Story, clarity, pacing, audio — over decoration.

## Typical requests and what to run

```bash
# Talking-head reel from footage
npm run video -- create --in interview.mp4 --ratio 9:16 --style reels --title "…" --role "…"

# Audio → animated story (describe it, don't script it)
npm run video -- create --in narration.mp3 --prompt "explain how a black hole bends light" --style 2d-animation

# Script → 3D motion graphics
npm run video -- create --script script.txt --style 3d-motion --title "Aurora"

# Prompt only
npm run video -- create --prompt "a 30s cinematic piece about a man missing his family abroad" --ratio 9:16

# Plan and storyboard without rendering
npm run video -- create --in input/ --no-render
```

## Where everything lands

```
projects/<name>-<id>/
├── video-plan.json     the timeline — authoritative, inspectable, re-renderable
├── storyboard.md       the shot list (scene, time, narration, visual, camera, FX, text, transition)
├── transcript.json     words + timings + provider
├── PROJECT_STATE.json  brief, inputs, providers, revision history
└── output/
    ├── final.mp4  thumbnail.jpg
    ├── captions.srt  captions.vtt  transcript.txt
    ├── audio-mix.wav   the master mix as muxed
    └── qc-report.md    measured verdict (resolution, duration, continuity, captions, black frames, exposure, audio, dead air)
```

Exit code `2` means it rendered but **QC failed** — read the report before delivering.

## Inspecting work

```bash
npm run video -- list                     # all projects, state, QC
npm run video -- plan <project>            # one line per scene
npm run video -- storyboard <project>      # the full shot list
npm run video -- render <project> --quality draft   # fast half-res review render
```

To look at a frame:

```bash
ffmpeg -ss 12 -i projects/<p>/output/final.mp4 -frames:v 1 frame.png
```

## Extending it

- **New scene type** — add a component in `components/scenes/`, register it in `components/scenes/registry.ts`, emit the type from a planner. Nothing else changes.
- **New look** — add tokens to `styles/tokens.ts` and a section to `STYLES.md`.
- **New visual vocabulary** — add a keyword rule to the lexicon in `engine/planner/visuals.ts`.
- **New provider** — implement `status()` + the work method, register it, and surface it in `providers/index.ts`.

## Documentation map

[README.md](../../README.md) · [SETUP.md](../../SETUP.md) · [ARCHITECTURE.md](../../ARCHITECTURE.md) · [PROVIDERS.md](../../PROVIDERS.md) · [STYLES.md](../../STYLES.md) · [VIDEO_WORKFLOW.md](../../VIDEO_WORKFLOW.md) · [COMMANDS.md](../../COMMANDS.md) · [TROUBLESHOOTING.md](../../TROUBLESHOOTING.md)
