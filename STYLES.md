# STYLES

A style is a set of tokens — palette, typography, motion intensity, caption behaviour, transition default, colour grade — plus, for two of them, a scene archetype. Styles are defined in [`styles/tokens.ts`](styles/tokens.ts); this document explains when to use each and what it will do.

Pick one explicitly with `--style`, or let it be inferred from the brief and the narration keywords.

```bash
npm run video -- create --script script.txt --style 3d-motion
```

## Inference

When `--style` is omitted, the planner reads the brief and the matched visual recipes:

| Signal | Style |
|---|---|
| "reel", "shorts", "tiktok", "vertical" | `reels` |
| "youtube", "vlog", "podcast" | `youtube` |
| "3d", "motion graphics" | `3d-motion` |
| "2d", "animation", "cartoon", "story" | `2d-animation` |
| "horror", "scary", "thriller" | `horror-story` |
| "documentary" | `documentary` |
| "ad", "commercial", "promo" | `advertisement` |
| "explain", "tutorial", "educational" | `explainer` |
| "corporate", "business", "training" | `corporate` |
| "minimal", "clean", "elegant" | `minimal` |
| "cinematic", "film", "moody" | `cinematic` |
| talking head → vertical | `reels` |
| talking head → landscape | `youtube` |
| majority of scenes 2D | `2d-animation` |
| otherwise | `cinematic` |

---

## The styles

### `cinematic`
Warm, filmic, restrained. Gold accent on near-black, Georgia titles, slow dissolves, heavy vignette and grain.

- **Use for:** trailers, brand films, narrative pieces, documentary B-roll.
- **Motion:** 0.45 intensity, slow camera.
- **Captions:** phrase mode, 78% down, warm white with a gold highlight.
- **Transition:** dissolve, 0.5s.
- **Grade:** vignette 0.35, grain 0.06, cool blue tint.

### `documentary`
Sober and quiet. Muted sand accent, faded captions, soft grain.

- **Use for:** interviews, explainer documentaries, journalistic pieces.
- **Motion:** 0.30 — the most restrained of the non-minimal styles.
- **Captions:** sentence mode, 80% down. Sentences, not karaoke.
- **Transition:** fade, 0.6s.

### `youtube`
Bright, high-contrast, energetic. Red accent, heavy sans titles, quick slides.

- **Use for:** long-form YouTube, vlogs, commentary, tutorials.
- **Motion:** 0.70.
- **Captions:** word mode, 76% down, yellow highlight on white with a strong stroke.

### `reels`
Loud, vertical-first, made for a phone. Mint accent, condensed bold type, uppercase captions on a translucent plate.

- **Use for:** Reels, Shorts, TikTok — 9:16 by default when this style is chosen.
- **Motion:** 0.80 — the most kinetic.
- **Captions:** word mode, 72% down, uppercase, background plate for legibility over footage.
- **Transition:** slide, 0.25s.

### `corporate`
Light background, blue accent, clean and legible. The only light-background style besides `minimal`.

- **Use for:** training, internal comms, presentations, product walkthroughs.
- **Motion:** 0.35.
- **Grade:** none — no vignette, no grain.

### `minimal`
Pure white, black type, almost no motion.

- **Use for:** typographic pieces, luxury brands, quiet product films.
- **Motion:** 0.20 — deliberately near-static.
- **Captions:** sentence mode, 85% down, no stroke.

### `2d-animation` — **archetype: 2D**
Night-blue illustrated palette, gold and cyan accents, generous motion. Forces every body scene to `two-d`.

- **Use for:** narrated stories, children's content, illustrated explainers.
- **Motion:** 0.60 with in-out easing.
- **Scene behaviour:** the keyword lexicon supplies the layer stack (e.g. ocean/lighthouse → `sky → stars → moon → sea → field` with a rotating beam and fireflies); if a beat matches nothing, a default parallax stack is used so the piece stays visually consistent.
- **Captions:** phrase mode, 80% down.

### `3d-motion` — **archetype: 3D**
Near-black, cyan and violet accents, strong vignette. Forces every body scene to `three-d`.

- **Use for:** product films, tech explainers, title sequences, animated infographics.
- **Motion:** 0.70, fastest camera.
- **Scene behaviour:** cycles through varied 3D setups so a multi-scene piece has progression — icosahedron orbit → box grid → torus explode → octahedron orbit — each with an orbiting camera, metal/emissive materials and a particle field.
- **Captions:** phrase mode, 80% down.

### `horror-story` — **archetype: 2D**
Near-black with blood-red accent, Georgia titles, heavy vignette and grain, long slow dissolves.

- **Use for:** creepypasta, true-scary narration, teaser trailers.
- **Motion:** 0.40 with long in-out easing — dread comes from stillness and slow drift, not cuts.
- **Grade:** vignette 0.60, grain 0.10 — the heaviest grade available.

### `explainer`
Punchy blue-gold, medium motion, short fades.

- **Use for:** educational content, how-it-works, listicles, ads with a teaching angle.
- **Motion:** 0.60.
- **Captions:** phrase mode with a warm highlight.

### `advertisement`
High-energy, orange and yellow accent, uppercase word captions, fast slides.

- **Use for:** product launch, promo, social ads.
- **Motion:** 0.75.
- **Captions:** word mode, uppercase, strong stroke.

---

## Token reference

Every style provides:

| Token | Meaning |
|---|---|
| `fonts.title / body / mono` | font stacks (system fonts, no webfont fetch) |
| `colors.bg / bgDeep / fg / muted / accent / accent2 / highlight` | palette |
| `motion.intensity` | 0–1, scales camera amplitude and effect strength |
| `motion.cameraSpeed`, `motion.ease` | camera feel |
| `caption` | mode (`phrase`/`word`/`sentence`), colour, highlight, stroke, background, position (0–1 from top), size, uppercase |
| `transition` | default `{type: fade|dissolve|slide|none, duration}` |
| `grade` | `vignette` 0–1, `grain` 0–1, `tint` rgba overlay |

Editorial restraint is the rule: intensity is a *ceiling*, not a target. A high-intensity style still animates only where it helps comprehension.

---

## Adding a style

1. Add an entry to `STYLES` in [`styles/tokens.ts`](styles/tokens.ts). Every field is required except none — copy an existing style and adjust.
2. If the style should force a scene technology, add it to `styleArchetype()` in [`engine/planner/visuals.ts`](engine/planner/visuals.ts).
3. Add a section here so the creative rules live next to the machine-readable tokens.
4. Verify:

```bash
npm run video -- create --script some-script.txt --style your-style --no-render
npm run video -- storyboard <project>     # confirm the look is described correctly
```

Because styles are pure data, no component changes are needed — and existing projects are unaffected until re-planned.
