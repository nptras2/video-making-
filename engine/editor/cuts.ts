/**
 * Talking-head cut planning — silence/pause analysis → keep-segments.
 *
 * Professional defaults: remove dead air longer than `maxGap`, keep a short
 * breath so cuts don't feel robotic, never chop words (silence detection with
 * padding does the work). Purely deterministic; no transcription needed.
 */
import {detectSilence, probe} from '../media/ffmpeg';
import type {KeepSegment} from '../media/ffmpeg';

export interface CutPlan {
  keep: KeepSegment[];
  removed: number; // seconds removed
  original: number;
}

export async function planSilenceCuts(
  input: string,
  opts: {maxGap?: number; keepGap?: number; minKeep?: number} = {},
): Promise<CutPlan> {
  const maxGap = opts.maxGap ?? 0.75; // silence longer than this gets trimmed
  const keepGap = opts.keepGap ?? 0.28; // …down to this much breath before the next line
  const minKeep = opts.minKeep ?? 0.4;

  const info = await probe(input);
  const total = info.duration;
  const silences = await detectSilence(input, {noiseDb: -35, minDur: maxGap});

  const keep: KeepSegment[] = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.end - s.start <= maxGap) continue; // short breath: leave untouched
    // keep the speech that ended at s.start, then resume just before speech
    // resumes so a short breath survives the cut
    if (s.start - cursor > 0.02) keep.push({start: cursor, end: s.start});
    cursor = Math.max(cursor, s.end - keepGap);
  }
  if (total - cursor > 0.02) keep.push({start: cursor, end: total});

  // drop slivers and merge neighbours closer than minKeep
  const merged: KeepSegment[] = [];
  for (const seg of keep) {
    const len = seg.end - seg.start;
    if (len < minKeep && merged.length > 0) continue;
    const prev = merged[merged.length - 1];
    if (prev && seg.start - prev.end < 0.05) {
      prev.end = seg.end;
    } else {
      merged.push({...seg});
    }
  }
  const kept = merged.reduce((a, s) => a + (s.end - s.start), 0);
  return {keep: merged, removed: Math.max(0, total - kept), original: total};
}

export interface RemapResult<T> {
  words: T[];
  /** words placed by drift tolerance rather than by real overlap */
  driftAdjusted: number;
  /** words too far from any kept region to belong to the edit */
  dropped: number;
}

/**
 * Remap word timings from the ORIGINAL timeline onto the EDITED timeline
 * produced by the keep-list, so one transcription serves both the cutting
 * decision and the final captions.
 *
 * Word timings from speech-to-text are *approximate* (whisper.cpp base drifts by
 * several hundred ms), which is much larger than a cut boundary. A naive
 * "is the midpoint inside a kept segment" test therefore deletes real spoken
 * words that merely appear to fall in the trimmed breath.
 *
 * So: a word is assigned to the kept segment it overlaps most, and a word with
 * no overlap but a plausible drift distance (`maxDriftMs`) is attached to the
 * nearest one rather than dropped. Only words far outside the edit are removed,
 * and the caller gets `dropped` / `driftAdjusted` so it can report the decision.
 */
export function remapWordsToCut<T extends {text: string; startMs: number; endMs: number}>(
  words: T[],
  keep: KeepSegment[],
  opts: {minWordMs?: number; maxDriftMs?: number} = {},
): RemapResult<T> {
  const minWordMs = opts.minWordMs ?? 60;
  const maxDriftMs = opts.maxDriftMs ?? 1500;
  if (keep.length === 0) return {words: [], dropped: words.length, driftAdjusted: 0};

  // cumulative timeline position of each kept segment
  const offsets: number[] = [];
  let acc = 0;
  for (const k of keep) {
    offsets.push(acc);
    acc += Math.max(0, k.end - k.start) * 1000;
  }

  let driftAdjusted = 0;
  let dropped = 0;
  const placed: Array<{word: T; startMs: number; endMs: number; order: number}> = [];

  words.forEach((w, order) => {
    const wStart = w.startMs;
    const wEnd = Math.max(w.endMs, w.startMs + 1);
    let best = -1;
    let bestOverlap = 0;
    let nearest = -1;
    let nearestDist = Infinity;
    keep.forEach((k, i) => {
      const s = k.start * 1000;
      const e = k.end * 1000;
      const overlap = Math.min(wEnd, e) - Math.max(wStart, s);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = i;
      }
      const dist = Math.max(0, Math.max(s - wEnd, wStart - e));
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });

    let idx = best;
    if (idx < 0) {
      if (nearestDist > maxDriftMs) {
        dropped++;
        return;
      }
      idx = nearest;
      driftAdjusted++;
    }

    const s = keep[idx].start * 1000;
    const e = keep[idx].end * 1000;
    const offset = offsets[idx];
    const startMs = Math.max(wStart, s) - s + offset;
    let endMs = Math.min(wEnd, e) - s + offset;
    if (endMs - startMs < minWordMs) endMs = startMs + minWordMs;
    placed.push({word: w, startMs, endMs, order});
  });

  // NOTE: word order is taken from the transcript, never re-derived by sorting
  // on timestamps. Speech-to-text token timings are approximate enough that
  // sorting by them reorders real sentences; the transcript order is correct by
  // construction, so timings are only ever clamped forward to stay monotonic.
  placed.sort((a, b) => a.order - b.order);
  for (let i = 1; i < placed.length; i++) {
    if (placed[i].startMs < placed[i - 1].endMs) {
      placed[i].startMs = placed[i - 1].endMs;
      if (placed[i].endMs < placed[i].startMs + minWordMs) {
        placed[i].endMs = placed[i].startMs + minWordMs;
      }
    }
  }

  return {
    words: placed.map((p) => ({...p.word, startMs: p.startMs, endMs: p.endMs})),
    driftAdjusted,
    dropped,
  };
}

/** Split a keep-list into editorial chunks (scene boundaries) of at most
 * `maxLen` seconds, snapping to word gaps when a transcript is available. */
export function chunkSegments(
  keep: KeepSegment[],
  opts: {maxLen?: number; wordGaps?: Array<{start: number; end: number}>} = {},
): KeepSegment[] {
  const maxLen = opts.maxLen ?? 6;
  const out: KeepSegment[] = [];
  for (const seg of keep) {
    let start = seg.start;
    while (seg.end - start > maxLen) {
      // prefer a gap near the midpoint (word boundary)
      let cut = start + maxLen;
      if (opts.wordGaps) {
        const target = start + maxLen;
        const candidates = opts.wordGaps.filter((g) => g.start > start + maxLen * 0.6 && g.start < target + 1.2);
        if (candidates.length > 0) {
          candidates.sort((a, b) => Math.abs(a.start - target) - Math.abs(b.start - target));
          cut = candidates[0].start;
        }
      }
      out.push({start, end: cut});
      start = cut;
    }
    if (seg.end - start > 0.05) out.push({start, end: seg.end});
  }
  return out;
}