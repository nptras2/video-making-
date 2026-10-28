/**
 * Caption serialisers — SRT and WebVTT from plan caption cues.
 *
 * The renderer uses word-level cues for karaoke highlighting; subtitle files
 * want readable phrases, so cues are regrouped here (never one word per line).
 */
import type {CaptionCue, CaptionTrack, CaptionWord} from '../types';
import {appendToken, isBracketedToken, isPunctuationOnly} from '../../providers/stt/index';

const pad = (n: number, len = 2) => String(Math.max(0, Math.floor(n))).padStart(len, '0');

/** ms → `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (VTT) */
export function formatTime(ms: number, sep: ',' | '.' = ','): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(millis, 3)}`;
}

const tidy = (text: string): string =>
  text
    .replace(/\s+([,.!?;:)\]])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s{2,}/g, ' ')
    .trim();

export interface CueGroupingOptions {
  maxWords?: number;
  maxChars?: number;
  /** split when the gap between words exceeds this */
  maxGapMs?: number;
  /** never emit a cue shorter than this */
  minDurationMs?: number;
}

/** Fine-grained cues → readable phrase cues for subtitle files. */
export function groupCues(cues: CaptionCue[], opts: CueGroupingOptions = {}): CaptionCue[] {
  const maxWords = opts.maxWords ?? 7;
  const maxChars = opts.maxChars ?? 42;
  const maxGap = opts.maxGapMs ?? 600;
  const minDur = opts.minDurationMs ?? 700;

  // Flatten to words, using cue words when available. Non-speech artefacts are
  // removed here too, so a stray `[BLANK_AUDIO]` can never become a subtitle.
  const raw: CaptionWord[] = [];
  for (const cue of cues) {
    if (cue.words && cue.words.length > 0) {
      raw.push(...cue.words);
    } else {
      const parts = tidy(cue.text).split(/\s+/).filter(Boolean);
      const span = cue.endMs - cue.startMs;
      parts.forEach((text, i) =>
        raw.push({
          text,
          startMs: cue.startMs + (span * i) / parts.length,
          endMs: cue.startMs + (span * (i + 1)) / parts.length,
        }),
      );
    }
  }
  const words: CaptionWord[] = [];
  for (const w of raw) {
    if (isBracketedToken(w.text)) continue;
    const prev = words[words.length - 1];
    // fold punctuation onto the word it belongs to instead of emitting a cue
    if (isPunctuationOnly(w.text)) {
      if (!prev) continue;
      prev.text = appendToken(prev.text, w.text);
      prev.endMs = Math.max(prev.endMs, w.endMs);
      continue;
    }
    words.push({...w});
  }
  if (words.length === 0) return [];

  const out: CaptionCue[] = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const text = tidy(current.map((w) => w.text).reduce(appendToken, ''));
    out.push({
      text,
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      words: current.slice(),
    });
    current = [];
  };

  for (const w of words) {
    if (current.length > 0) {
      const prev = current[current.length - 1];
      const chars = current.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length;
      const sentenceEnd = /[.!?…]\)?$/.test(prev.text);
      const gap = w.startMs - prev.endMs;
      if (current.length >= maxWords || chars > maxChars || sentenceEnd || gap > maxGap) flush();
    }
    current.push(w);
  }
  flush();

  // enforce a minimum readable duration without creating overlaps
  for (let i = 0; i < out.length; i++) {
    if (out[i].endMs - out[i].startMs < minDur) {
      const nextStart = i < out.length - 1 ? out[i + 1].startMs : out[i].endMs + minDur;
      out[i].endMs = Math.min(nextStart - 1, out[i].startMs + minDur);
    }
  }
  return out;
}

/**
 * Cues to subtitle file text.
 * `stretch` shortens the last cue if it runs past the rendered duration.
 */
export function toSrt(track: CaptionTrack, opts: CueGroupingOptions = {}): string {
  const cues = groupCues(track.cues, opts);
  return (
    cues
      .map((c, i) => `${i + 1}\n${formatTime(c.startMs, ',')} --> ${formatTime(c.endMs, ',')}\n${c.text}\n`)
      .join('\n') + (cues.length > 0 ? '' : '')
  );
}

export function toVtt(track: CaptionTrack, opts: CueGroupingOptions & {title?: string} = {}): string {
  const cues = groupCues(track.cues, opts);
  const head = `WEBVTT${opts.title ? ` - ${opts.title}` : ''}\n\n`;
  return (
    head +
    cues.map((c) => `${formatTime(c.startMs, '.')} --> ${formatTime(c.endMs, '.')}\n${c.text}\n`).join('\n')
  );
}

/** Percentage of the timeline covered by captions (0..1). */
export function captionCoverage(track: CaptionTrack | undefined, durationSec: number): number {
  if (!track || track.cues.length === 0 || durationSec <= 0) return 0;
  const cues = groupCues(track.cues);
  const covered = cues.reduce((a, c) => a + Math.max(0, c.endMs - c.startMs), 0) / 1000;
  return Math.min(1, covered / durationSec);
}

/** Plain text transcript with one utterance per line — used as an .txt export. */
export function toPlainText(track: CaptionTrack): string {
  return groupCues(track.cues)
    .map((c) => c.text)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
