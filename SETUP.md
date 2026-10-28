# SETUP

## 1. Requirements

| Requirement | Notes |
|---|---|
| **Node.js ≥ 20** | developed and verified on Node 24 |
| **FFmpeg + ffprobe on PATH** | the media layer. Verified against FFmpeg 9.0.2. Must include `libx264`, `aac`, `lavfi` (sine/anoisesrc/gradients), and the `silencedetect` / `blackdetect` / `volumedetect` / `signalstats` filters — the standard full builds have all of these |
| **Internet, once** | Remotion downloads its headless Chromium on first render; whisper.cpp downloads its binary + model on first transcription. After that everything runs offline |
| **Windows, macOS or Linux** | offline narration currently uses Windows `System.Speech`. On macOS/Linux narration needs `ELEVENLABS_API_KEY` or `OPENAI_API_KEY`; everything else works everywhere |

Check FFmpeg yourself if a render fails early:

```bash
ffmpeg -version
ffmpeg -hide_banner -f lavfi -i sine=f=220:d=1 -f null -   # must succeed
```

If FFmpeg is not on `PATH`, point at it explicitly in `.env`:

```
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
```

## 2. Install

```bash
npm install
```

That installs Remotion, React Three Fiber, `@remotion/three`, `zod`, `tsx` and TypeScript. No global installs are needed.

## 3. Check what this machine can do

```bash
npm run video -- doctor
```

Legend: `◆` api-backed · `●` local/offline · `○` unavailable. It finishes with the capability gaps and the fallback used for each. The first run may take a minute: it installs the whisper.cpp binary and the `base` model into `node_modules/.whisper/` (once, ~150 MB).

## 4. Configure (optional)

Everything works with no configuration. To add capability, copy the template and fill in only what you want:

```bash
cp .env.example .env
```

`.env` and `.env.local` are loaded automatically by the CLI (project root; real environment variables take precedence). `.env` is git-ignored — never commit keys.

| Key | Unlocks | Fallback without it |
|---|---|---|
| `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`, `VIDEO_LLM_MODEL`) | LLM director plans the timeline; drafts a script for prompt-only jobs; image generation; cloud STT/TTS | deterministic local planner; prompt-only jobs become a typographic motion piece (no invented narration) |
| `LLM_API_KEY` + `LLM_BASE_URL` | same LLM features via any OpenAI-compatible endpoint | as above |
| `ELEVENLABS_API_KEY` | broadcast-quality narration | Windows `System.Speech` |
| `WHISPER_MODEL` (default `base`) | better word timings (`small`, `medium`, `large-v3`) | `base` |
| `PEXELS_API_KEY` / `PIXABAY_API_KEY` / `UNSPLASH_ACCESS_KEY` | automatic stock B-roll and stills | supplied media only; reported as skipped |
| `JAMENDO_CLIENT_ID` | licensed music search | FFmpeg-synthesised music beds |
| `LUMA_API_KEY` / `RUNWAY_API_KEY` / `REPLICATE_API_TOKEN` | AI video generation | camera moves over stills, procedural animation, FFmpeg editing |
| `STABILITY_API_KEY` | AI image generation | procedural 2D/3D scenes |

Verify:

```bash
npm run video -- doctor
```

## 5. Build the demo fixtures (optional)

Creates real, synthetic test media locally — a talking-head clip with narration and deliberate pauses, three B-roll stills, a narration-only story, and a product script. Nothing is downloaded and no third-party footage is used.

```bash
npx tsx scripts/make-test-assets.ts
```

Then run any of the three reference productions:

```bash
npm run video -- create --in outputs/test-assets/talking-head.mp4 \
  --image outputs/test-assets/dead-air-editing.png \
  --ratio 9:16 --style reels --title "Cut The Dead Air" --name demo-reel

npm run video -- create --in outputs/test-assets/lighthouse-narration.wav \
  --style 2d-animation --title "The Keeper" --name demo-2d

npm run video -- create --script outputs/test-assets/tech-script.txt \
  --style 3d-motion --title "Aurora" --name demo-3d
```

## 6. Optional: the `video` command

```bash
npm link
video create --in input/ --prompt "a 30 second explainer"
```

`npm link` registers `bin/video.mjs`, which runs the TypeScript CLI through the project's own `tsx` — no build step, works on Windows/macOS/Linux. To undo: `npm unlink -g video-engine`.

## 7. Optional: the Remotion studio

To scrub a composition interactively while developing new scene types:

```bash
npm run studio
```

It opens the demo plan (`templates/demo-plan.json`). Point it at a real project by copying its `video-plan.json` there.

## 8. Where things go

| Path | Purpose |
|---|---|
| `input/` | default drop folder — `video create` with no `--in` uses it |
| `projects/` | one folder per production (plan, storyboard, outputs, state) |
| `outputs/` | scratch: test fixtures, diagnostics |
| `templates/` | `demo-plan.json`, used by the studio |
| `node_modules/.whisper/` | whisper.cpp binary + ggml models |
