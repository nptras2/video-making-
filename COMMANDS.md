# COMMANDS

Every command runs through the project's own `tsx`. After `npm link`, `video` works directly.

```bash
npm run video -- <command> [options]
video <command> [options]          # after npm link
```

```
create [inputs…] [options]     produce a video from whatever you have
revise <project> --note "…"    re-plan and re-render with a change
render <project>               re-render the saved plan (no re-planning)
storyboard <project>           print STORYBOARD.md
plan <project>                 print the timeline summary
list                           list every project
doctor                         report available providers and capabilities
help                           usage
```

---

## `create`

```bash
npm run video -- create --in input/ --prompt "a 45s explainer" --ratio 9:16
```

### Inputs

Any of these, in any combination. Directories are expanded to their media files.

| Flag | Meaning |
|---|---|
| `-i, --in <paths…>` | files and/or folders. Defaults to `./input` when nothing else is given |
| `--script <file>` | script file — counts as input material (`.txt`, `.md`, `.srt`, `.vtt`, `.json`, `.csv`) |
| `--audio <file>` | narration / voiceover audio |
| `--video <file>` | footage (talking head or B-roll) |
| `--image <files…>` | stills to animate |
| `--reference <file>` | style reference, recorded in the project |
| positional args | treated as inputs: `create interview.mp4 script.txt` |

### Output control

| Flag | Default | Meaning |
|---|---|---|
| `--ratio <r>` | inferred | `16:9` `9:16` `1:1` `4:5` |
| `--fps <n>` | `30` | `24` `25` `30` `50` `60` |
| `--duration <sec>` | auto | target length |
| `--style <name>` | inferred | see [STYLES.md](STYLES.md) |
| `--title <text>` | — | title card / project title |
| `--role <text>` | — | lower-third subtitle, e.g. `"Senior Editor"` |
| `--name <text>` | from title/prompt | project folder name |
| `--lang <code>` | auto | speech language (`en`, `hi`, …) |
| `--prompt <text>` | — | what you want, in your own words |

### Switches

| Flag | Effect |
|---|---|
| `--voiceover` | force narration synthesis even when input audio exists |
| `--captions` / `--no-captions` | enable (default) / disable captions |
| `--music` / `--no-music` | enable (default) / disable the music bed |
| `--render` / `--no-render` | full render (default) / plan + storyboard only |
| `--qc` / `--no-qc` | run (default) / skip quality control |
| `--json` | machine-readable summary on stdout |
| `-h, --help` | usage |

`--no-…` works for every boolean switch above.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | success, QC pass or warn |
| `1` | failed before or during production (message + real ffmpeg/provider diagnostics) |
| `2` | the video rendered but **QC failed** — inspect `output/qc-report.md` |

### Examples

```bash
# talking-head reel, vertical, with B-roll
npm run video -- create --in interview.mp4 \
  --image shots/ --ratio 9:16 --style reels --title "Cut The Dead Air" --role "Editor"

# audio → 2D story (drop the narration in ./input and just describe it)
npm run video -- create --in narration.mp3 --prompt "how a black hole works" --style 2d-animation

# script → 3D motion graphics
npm run video -- create --script product.txt --style 3d-motion --title "Aurora"

# prompt only, vertical
npm run video -- create --prompt "a 30s cinematic piece about a man missing his family abroad" --ratio 9:16

# plan and storyboard only — no render
npm run video -- create --in input/ --no-render --json
```

### What you get

```
projects/<name>-<id>/
├── video-plan.json        the timeline (machine)
├── storyboard.md          the shot list (human)
├── transcript.json        words + timings + provider
├── PROJECT_STATE.json     brief, inputs, providers, revisions
├── public/  work/         staged media, intermediates
└── output/
    ├── final.mp4  thumbnail.jpg
    ├── captions.srt  captions.vtt  transcript.txt
    ├── audio-mix.wav      the master mix
    └── qc-report.md       measured verdict
```

---

## `revise`

```bash
npm run video -- revise <project> --note "tighter pacing" [--ratio 9:16] [--style reels] \
  [--fps 30] [--captions] [--no-captions] [--music] [--no-music] [--render] [--no-render]
```

`--note` is required and is recorded in the project's revision log. The project name may be the full folder name, a unique prefix, or a path. Because media is already staged, a revision re-plans and re-renders without re-ingesting.

## `render`

```bash
npm run video -- render <project> [--quality draft] [--scale 0.5]
```

Re-renders `video-plan.json` as-is. `--quality draft` is shorthand for `--scale 0.5` (half resolution, much faster — for reviewing pacing, not delivery).

## `storyboard`

```bash
npm run video -- storyboard <project>
```

Prints `storyboard.md`, regenerating it from the plan if missing. Each scene lists timecode, narration, visual, source, camera, depth layers, animation/FX, text, transition, then overlays, audio, captions and credits.

## `plan`

```bash
npm run video -- plan <project>
```

One line per scene with its type, time range, overlay marker and source — the fastest way to sanity-check an edit.

## `list`

```bash
npm run video -- list
```

Every project with style, ratio, rendered state, QC verdict and revision count.

## `doctor`

```bash
npm run video -- doctor
```

Probes every provider and prints the capability board, then the gaps and their fallbacks, then the optional keys. The first run may install whisper.cpp.

---

## Environment

`.env` and `.env.local` in the project root are loaded automatically (real environment variables win). See [.env.example](.env.example) and [PROVIDERS.md](PROVIDERS.md).

Debugging:

```bash
VIDEO_DEBUG=1 npm run video -- create ...      # stack traces on CLI errors
```

## Developer scripts

```bash
npm run typecheck          # tsc --noEmit
npm run studio             # Remotion studio on templates/demo-plan.json
npm run render             # remotion render src/index.ts Main outputs/demo.mp4

npx tsx scripts/make-test-assets.ts    # build the demo fixtures
npx tsx scripts/smoke-stt.ts           # TTS → STT round-trip check
npx tsx scripts/smoke-music.ts         # verify offline music/SFX synthesis
npx tsx scripts/diag-cut.ts            # dump silences, keep-list, word coverage
```
