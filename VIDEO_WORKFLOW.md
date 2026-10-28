# VIDEO_WORKFLOW

How each input mode is produced, end to end. The mode is chosen from your **material** — supplying a `--prompt` never changes it.

```
MODE A  video + speech     → cut → B-roll → captions
MODE B  video, silent      → footage + script/VO
MODE C  audio only         → transcribe → a scene per beat
MODE D  script only        → beats → TTS → animated scenes
MODE E  prompt only        → script (LLM) or typographic piece
MODE F  images + script    → stills with camera moves
MODE G  any mix            → routed by what can carry the edit
```

---

## MODE A — video with speech (talking head)

```bash
npm run video -- create --in interview.mp4 --ratio 9:16 --style reels \
  --title "Cut The Dead Air" --role "Senior Editor"
```

Verified reference run: **11.9s of dead air removed from 35s, 8 scenes, captions at 94% coverage, QC pass.**

1. **Probe** the video; extract mono 16 kHz audio.
2. **Transcribe** with whisper.cpp to get words + timings.
3. **Detect silence** (`silencedetect`, −35 dB, ≥0.75 s).
4. **Plan the cut**: silence longer than 0.75 s is trimmed, but ~0.28 s of breath is kept so cuts do not feel robotic. Never chops mid-word — the cut only ever lands in detected silence.
5. **Cut with FFmpeg** (`trim` + `concat` per keep-segment, frame-accurate) and extract the cut's own WAV, so picture and sound stay in sync by construction.
6. **Remap the transcript** onto the edited timeline (`remapWordsToCut`) rather than transcribing twice. Word timings from STT are approximate, so words that merely *appear* to fall in a trimmed breath are anchored to the nearest kept segment instead of being deleted.
7. **Scene per chunk**: the keep-list is split into ~6.5 s chunks, snapping to word gaps. Alternate subtle punch-ins (1.07×) on odd chunks — never constant motion.
8. **B-roll**: supplied images/videos (and stock, if keyed) are matched to narration keywords and placed as `overlay` scenes with a push-in, only where the words actually support them.
9. **Lower third** from `--title` / `--role`.
10. **Captions** from the remapped transcript, word-level karaoke.
11. **Music**: supplied, or synthesised to the plan duration and sidechain-ducked under speech.
12. **Render → mux → QC**.

**Editorial note.** This path is deliberately conservative: it removes hesitation, keeps breath, and refuses to add an effect unless the narration earns it.

---

## MODE B — video without audio

```bash
npm run video -- create --in broll.mp4 --script voiceover.txt --ratio 16:9
```

The footage is the visual spine; the script (or an LLM-drafted one) becomes the narration. Where the footage is shorter than the narration, the planner extends the edit with procedural scenes rather than freezing a frame.

---

## MODE C — audio only (the important one)

```bash
npm run video -- create --in narration.mp3 --prompt "explain how a black hole bends light"
```

Verified reference run: **30s narration → 6 scenes, all selecting the ocean/lighthouse 2D recipe, QC pass.**

1. **Transcribe** the audio to words + timings.
2. **Group into beats** (utterances; micro-segments under 1.6 s merge into the previous beat).
3. **Understand each beat** by matching the visual lexicon — "lighthouse", "ocean", "storm" select a layered night seascape with a rotating beam and fireflies; "market", "growth" select animated bars; "software", "product" select 3D motion graphics.
4. **Scene per beat**, each starting and ending exactly on its spoken segment. Supplied images are used where their filenames match the words; otherwise the matched procedural scene is used.
5. **Audio**: your narration track at full level, plus a synthesised (or supplied) music bed ducked underneath.
6. **Captions** from the same transcript.
7. **Render → mux → QC**.

An explicit `--style` does not override the content: with `--style 2d-animation` the *art direction* still follows the words, while the *scene technology* stays 2D so the piece is consistent.

---

## MODE D — script only

```bash
npm run video -- create --script script.txt --style 2d-animation --title "The Keeper"
```

Verified reference runs: **55-word product script → 4 × 3D scenes; 6-sentence story → 6 × 2D scenes.**

```
SCRIPT → STORY ANALYSIS → SCENE BREAKDOWN → VISUAL STORYBOARD →
VOICEOVER → MUSIC → ANIMATION → CAPTIONS → FINAL VIDEO
```

1. **Beats**: sentences grouped to ~14 words.
2. **Recipe per beat** from the visual lexicon, or forced by the style archetype.
3. **Narration**: each beat is synthesised (ElevenLabs → OpenAI → local) and measured, so scenes are timed to the *real* audio length plus a 0.35 s breath — never to a guess.
4. **Narration placement**: each clip is placed at its own scene's start on the timeline.
5. **Captions**: the assembled narration timeline is transcribed, so captions match the actual synthesized speech. If STT is unavailable, word timings are distributed across each clip and labelled as estimated.
6. **Music** synthesised to the plan duration, mood-matched to the style.
7. **Render → mux → QC**. Verified coverage: 95% of the timeline captioned, 65 words.

---

## MODE E — prompt only

```bash
npm run video -- create --prompt "a 30 second film about a Punjabi man missing his family abroad" --ratio 9:16
```

Two honest paths:

- **With an LLM key** → `draftNarration` writes a script (~2.5 words/second of target duration) and the run continues exactly as MODE D. The drafted script is saved to `work/drafted-script.txt`.
- **Without a key** → a typographic/procedural motion piece is built directly from your prompt text, with **no invented narration**. The run says so explicitly.

The engine will not fabricate a story and present it as your content.

---

## MODE F — images + script

```bash
npm run video -- create --in stills/ --script narration.txt --ratio 9:16
```

Each still becomes a Ken Burns scene — `push-in`, `pan-left/right/up/down` — applied over a real 3× scale range so the movement is visible but not gimmicky. Stills are matched to narration keywords by filename (`lighthouse.png` ↔ "the lighthouse"), falling back to round-robin. Layer stacks (`scene.layers`) turn a still into a multi-plane 2.5D parallax scene; `ParallaxStack` moves each plane by its `depth`, so near layers travel further than far ones.

---

## MODE G — mixed

```bash
npm run video -- create --in footage.mp4 --in voice.wav --in logo.png --script notes.md
```

Routing, in priority order:

1. video with audio → **MODE A** treatment of the primary clip;
2. otherwise transcribed narration → **MODE C** treatment, with supplied media as B-roll;
3. otherwise a script → **MODE D**;
4. otherwise a prompt → **MODE E**.

---

## Formats

```bash
--ratio 16:9   # 1920×1080  (default)
--ratio 9:16   # 1080×1920  (reels, shorts, tiktok)
--ratio 1:1    # 1080×1080  (feed)
--ratio 4:5    # 1080×1350  (portrait feed)
--fps 24|25|30|50|60         # default 30
--duration 45                # target seconds
```

`--ratio` is also inferred from the brief: "reel", "shorts", "vertical" → 9:16; "cinematic", "youtube" → 16:9.

---

## Audio design

- Narration and source audio sit at unity; music sits at ~0.28–0.32.
- Music is ducked by a **real sidechain compressor** (`sidechaincompress`, threshold 0.04, ratio 8, 25 ms attack, ~620 ms release) keyed off the summed narration — not by a volume ramp.
- The master is loudness-normalised and padded/trimmed to exactly the plan duration, so the mux never drifts.
- The final audio is AAC 192 kbps; the pre-mux master WAV is kept as `output/audio-mix.wav`.

## Captions

- Word-level cues from the transcript; karaoke highlighting follows `style.caption.highlightColor`.
- Punctuation folds onto its word; `[BLANK_AUDIO]`-style markers are stripped; cues are regrouped to ≤7 words / 42 chars for subtitle files.
- Exported as `captions.srt`, `captions.vtt` and `transcript.txt` alongside the video.
- Disable with `--no-captions`.

## Revisions

```bash
npm run video -- revise <project> --note "tighter pacing"   # re-plan + render
npm run video -- revise <project> --note "vertical cut" --ratio 9:16
npm run video -- render <project>                           # re-render saved plan only
```

Revisions append to `PROJECT_STATE.json`, so the history of a project is auditable.
