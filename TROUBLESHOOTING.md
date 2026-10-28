# TROUBLESHOOTING

Every entry below is a real failure hit while building this engine, with its actual cause and fix. Start with `npm run video -- doctor`, then find your symptom.

---

## First moves

```bash
npm run video -- doctor                     # what is available, and what is missing
npm run video -- plan <project>             # is the timeline what you expect?
cat projects/<project>/output/qc-report.md  # measured verdict, per check
cat projects/<project>/storyboard.md        # the shot list actually planned
VIDEO_DEBUG=1 npm run video -- create …     # stack traces
```

Because `video-plan.json` is written *before* rendering, a failed render never loses the plan. Fix the cause and `npm run video -- render <project>`.

---

## Setup problems

### `ffmpeg exited with code …` / `Failed to start ffmpeg`

FFmpeg is not on `PATH`. Confirm with `ffmpeg -version`, then either add it to `PATH` or set in `.env`:

```
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
```

The error message always includes the exact command line and the last lines of FFmpeg's own stderr — read those first.

### A filter is reported missing (`No such filter`)

You are on a minimal FFmpeg build. The engine needs `libx264`, `aac`, `lavfi` sources (`sine`, `anoisesrc`, `aevalsrc`, `gradients`) and the `silencedetect`, `blackdetect`, `volumedetect`, `signalstats`, `sidechaincompress`, `loudnorm`, `tremolo` filters. Install a full build.

### Remotion's browser download fails on first render

The first render downloads headless Chromium. It needs internet once. Re-run; the download is cached in the Remotion cache directory. Behind a proxy, set `HTTPS_PROXY` before running.

### `Cannot find module 'zod'` or a Remotion/zod version error

Remotion validates input props with the installed zod. This repo pins `zod@^4.5.4` for that reason. If you changed it:

```bash
npm install zod@4.5.4
```

---

## Speech-to-text

### First transcription takes minutes

Expected once. whisper.cpp and the model are being installed into `node_modules/.whisper/` (~150 MB). Later runs are offline and fast.

### `installWhisperCpp` fails on Windows

whisper.cpp **v1.5.5** is pinned because Remotion hosts a proven Windows binary for it, laid out with `main.exe` at the root of the install directory. The installer requires the target directory *not* to exist. If it is left half-written:

```bash
rm -rf node_modules/.whisper
npm run video -- doctor
```

### Transcription returns no words, or the pipeline says "no speech-to-text provider"

- Confirm `doctor` shows `● whisper.cpp`.
- Very quiet audio: silence detection and STT both struggle. Normalise first:

```bash
ffmpeg -i in.mp4 -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:v copy normalised.mp4
```

- Non-speech audio (music, ambience) legitimately produces nothing. The engine then edits by silence only and reports that captions are unavailable — it does not guess.

### Captions are slightly out of sync, or a word appears where a pause was

`whisper.cpp` **`base`** word timings are approximate — drift of a few hundred milliseconds is normal, and the drift is what used to make captions lose words. Two things are already handled for you: words are never dropped because of drift (they are anchored to the nearest kept segment), and word order always comes from the transcript, never from sorting timings.

For tighter sync, use a larger model:

```
WHISPER_MODEL=small      # or medium / large-v3
```

### Captions contain `[BLANK_AUDIO]`, `[BLANK`, or odd fragments like `Sh ips`

This was a real bug and is fixed: whisper emits non-speech markers, and its BPE tokens split words into subwords. `speechWords()` strips markers (including markers that arrive split across several tokens) and `normalizeWords()` merges subwords using whisper's own leading-space convention. If you see this again, check that your provider's `words` are being passed through both.

---

## Editing and captions

### A word seems missing from the captions

Check the run notes for:

> _N transcribed word(s) fell outside the edited timeline and were not captioned._

Those are words more than 1.5 s outside any kept segment — usually hallucinated during noise, not real speech. To keep everything regardless, re-plan with a lower `maxGap` (fewer cuts) by editing the `planSilenceCuts` options in `engine/pipeline.ts`, or use a better STT model.

### The edit feels jumpy / cuts feel robotic

The cut keeps 0.28 s of breath by default and only trims silence ≥ 0.75 s. To be gentler, raise `maxGap` in `engine/pipeline.ts`:

```ts
const cutPlan = await planSilenceCuts(primaryVideo.path, {maxGap: 1.0, keepGap: 0.45});
```

Higher `maxGap` = fewer cuts. Higher `keepGap` = more air retained.

### Narration all plays over the first few seconds

This was a real bug (fixed): narration clips used to be placed at timeline 0 instead of at their own scene's start. Symptom: caption coverage far below 100% and speech only at the beginning. Verify with:

```bash
node -e "const p=require('./projects/<project>/video-plan.json');console.log(p.audio.map(a=>a.role+'@'+a.start))"
```

Voiceover entries should have increasing start times.

---

## Audio mixing

### `No such filter: ''` / `Output pad … is already connected` / the mix hangs

The FFmpeg mixer is stricter than it looks and all three were real bugs:

- **stray comma** — a filter chain must not end with `,` before its output label;
- **a labelled pad can only be consumed once** — narration feeding both the duck sidechain *and* the final mix must be explicitly split (`asplit=2`);
- **`apad` with no bound pads to infinity**, and `amix duration=longest` then never terminates — every stream is padded and trimmed to `totalSec` instead.

If you extend `mixAudio`, preserve those three invariants. `opts.totalSec` is required whenever an input has no explicit `duration`.

### Music is not ducking under the narration

Ducking requires a track with `role: 'music'` **and** a track with `role: 'voiceover'` or `'source'`. If both exist, `sidechaincompress` is inserted and the mix log will show it. If the narration track is missing (no VO, silent source), there is nothing to key off and no ducking is expected.

### Audio is too quiet / clips

`output/qc-report.md` reports peak and mean dB. Clipping (> −0.5 dB) and excessive quiet (< −32 dB) both fail or warn. The master is loudness-normalised to −16 LUFS with a −1.5 dB true peak; adjust in `engine/media/ffmpeg.ts` (`loudnorm`) if your delivery spec differs.

---

## Planning

### Wrong scenes: an audio job planned from my prompt text

This was a real bug (fixed). A prompt is an *instruction about the output*, not a script — supplying `--prompt` used to flip an audio-only job to "mixed", after which the prompt was planned as the script and the narration was ignored. Now:

- mode is decided by the **material** (`hasVideo` / audio / images / text file), never by whether a brief was present;
- only text files count as script content;
- if a narration transcript exists, scenes always follow the narration.

Symptom to recognise: very few scenes for a long audio file, or the project state saying `mixed` when you supplied only audio.

### Everything came out `abstract`/empty when I asked for 3D

Fixed: an explicit `--style` now forces the scene technology via `styleArchetype()` while the keyword lexicon still drives art direction. `--style 3d-motion` must produce `three-d` scenes (`video-plan.json` should show `"type": "three-d"`).

### Prompt-only mode produced no narration

Expected without an LLM key: the engine builds a motion piece from your prompt and explicitly refuses to invent a script. Set `OPENAI_API_KEY` (or `LLM_API_KEY` + `LLM_BASE_URL`) to enable script drafting.

### "AI director unavailable/failed (…)" and it used the local planner

The LLM path is strictly optional and validated. Any of these fall back cleanly:

- no credentials;
- HTTP error (the message includes status + body excerpt);
- response was not JSON (markdown fences are tolerated, prose is not);
- response failed schema validation;
- the plan referenced assets that were never staged.

The deterministic planner always produces a usable plan.

---

## Rendering

### Rendering is slow

Rendering is CPU-bound. `--no-render` for planning-only, `render <project> --quality draft` (0.5×) for pacing review, and lower the length with `--duration`. A 1080p 30 fps render of ~25 s takes roughly one minute on a typical desktop.

### WebGL / 3D scenes render black or the render crashes on 3D scenes

3D uses React Three Fiber inside `@remotion/three`, with `chromiumOptions.gl = 'angle'` on Windows and `swangle` elsewhere. If you change the renderer, keep a software-capable GL backend — headless Chrome has no GPU acceleration.

### A scene shows "Missing media for scene …"

A `clip`/`image` scene references a `src` that is not in the project's `public/` directory. Staged files must go through `stageAsset()`. QC also fails on this (`Asset references`).

### Black or empty frames reported by QC

The check counts pixels below luma **10/255** for at least 0.25 s — genuinely empty frames, not dark footage. A separate `Exposure` check reports average and darkest luma and only warns when the picture stays below **12/255** for over 0.6 s. If `Black frames` fails, media really is missing; check the scene's `src` and the asset list in `storyboard.md`.

---

## CLI

### `Unknown option '--no-render'`

Fixed: `parseArgs` has no `--no-x` negation, so the CLI pre-processes the negatable switches (`--no-captions`, `--no-music`, `--no-render`, `--no-qc`, `--no-voiceover`, `--no-json`) itself. If you add a boolean flag you want negatable, add its name to `NEGATABLE` in `cli/index.ts`.

### `Nothing to work with` when I passed `--script`

Fixed: a script file now counts as input material before the emptiness guard runs. Also remember `video create` with no `--in` uses `./input`.

### Project not found

`<project>` matches the full folder name, a unique prefix (`video storyboard test1`), or a path. Ambiguous or unknown names list nothing — use `video list` to see exact ids.

---

## Project and cleanup

### Disk usage grows

`projects/*/public/` holds a copy of every staged asset (Remotion needs them served from a per-project directory), and `work/` keeps intermediates. Safe to remove:

```bash
rm -rf projects/<old-project>          # whole project
rm -rf projects/*/work/out             # regenerate on next render
```

Keep `video-plan.json` and `output/` if you want to re-render or revise later.

### Start clean

```bash
rm -rf projects outputs out            # all productions and scratch output
rm -rf node_modules/.whisper           # reinstall whisper.cpp + model
```

## Reporting a problem

Include: the full CLI output (the step lines), the exact FFmpeg command line from the error, `output/qc-report.md`, and the relevant part of `video-plan.json`. The `doctor` output tells us which capabilities were in play.
