/**
 * Quality control — verifies the rendered file against the plan and flags real
 * defects (wrong duration, black frames, clipping, silent audio, timeline holes).
 *
 * QC never blocks a render and never "fixes" anything silently: it reports
 * pass/warn/fail per check, writes qc-report.md, and the pipeline surfaces any
 * non-pass result in its summary.
 */
import {audioPeakDb, detectBlackFrames, detectSilence, frameLumaSeries, probe} from '../media/ffmpeg';
import {captionCoverage} from '../captions/index';
import type {VideoPlan} from '../types';

export type QcLevel = 'pass' | 'warn' | 'fail';

export interface QcCheck {
  name: string;
  level: QcLevel;
  detail: string;
}

export interface QcReport {
  checks: QcCheck[];
  level: QcLevel;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  sizeBytes: number;
}

export interface QcOptions {
  /** skip the ffmpeg-based frame/audio scans (fast mode) */
  skipMediaScans?: boolean;
}

const worst = (a: QcLevel, b: QcLevel): QcLevel => {
  const order: QcLevel[] = ['pass', 'warn', 'fail'];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
};

export async function runQc(opts: {plan: VideoPlan; file: string; options?: QcOptions}): Promise<QcReport> {
  const {plan, file} = opts;
  const checks: QcCheck[] = [];
  const push = (name: string, level: QcLevel, detail: string) => checks.push({name, level, detail});

  const p = await probe(file);
  const stat = await import('node:fs').then((m) => m.promises.stat(file));

  /* ---------------------------- container checks ---------------------------- */

  const sizeMb = stat.size / 1_048_576;
  push(
    'Output file',
    stat.size > 20_000 ? 'pass' : 'fail',
    `${sizeMb.toFixed(2)} MB, ${p.hasVideo ? 'video' : 'NO VIDEO'}${p.hasAudio ? ' + audio' : ' (silent)'}`,
  );

  if (!p.hasVideo) {
    push('Video stream', 'fail', 'rendered file contains no video stream');
  } else {
    const resMatch = p.width === plan.format.width && p.height === plan.format.height;
    push(
      'Resolution',
      resMatch ? 'pass' : 'fail',
      `${p.width}×${p.height} (planned ${plan.format.width}×${plan.format.height})`,
    );
    const fpsDelta = Math.abs((p.fps ?? 0) - plan.format.fps);
    push('Frame rate', fpsDelta < 0.05 ? 'pass' : 'warn', `${(p.fps ?? 0).toFixed(2)} fps (planned ${plan.format.fps})`);
  }

  const durDelta = Math.abs(p.duration - plan.duration);
  push(
    'Duration',
    durDelta < 0.35 ? 'pass' : durDelta < 1.5 ? 'warn' : 'fail',
    `${p.duration.toFixed(2)}s rendered vs ${plan.duration.toFixed(2)}s planned (Δ ${durDelta.toFixed(2)}s)`,
  );

  /* ------------------------------ timeline logic ------------------------------ */

  const base = plan.scenes
    .filter((s) => s.track !== 'overlay')
    .slice()
    .sort((a, b) => a.start - b.start);

  let holes = 0;
  let overlaps = 0;
  for (let i = 0; i < base.length - 1; i++) {
    const gap = base[i + 1].start - (base[i].start + base[i].duration);
    if (gap > 0.12) holes++;
    if (gap < -0.12) overlaps++;
  }
  push(
    'Timeline continuity',
    holes === 0 && overlaps === 0 ? 'pass' : 'warn',
    `${base.length} base scenes, ${holes} gap(s), ${overlaps} overlap(s)`,
  );
  if (base.length > 0 && base[0].start > 0.15) {
    push('Timeline start', 'warn', `first scene starts at ${base[0].start.toFixed(2)}s (should be 0)`);
  }

  const tooShort = base.filter((s) => s.duration < 0.5);
  const tooLong = base.filter((s) => s.duration > 18);
  push(
    'Scene durations',
    tooShort.length === 0 && tooLong.length === 0 ? 'pass' : 'warn',
    tooShort.length || tooLong.length
      ? `${tooShort.length} scene(s) under 0.5s, ${tooLong.length} over 18s`
      : `all scenes between 0.5s and 18s (avg ${(base.reduce((a, s) => a + s.duration, 0) / Math.max(1, base.length)).toFixed(1)}s)`,
  );

  const missingSrc = plan.scenes.filter((s) => (s.type === 'clip' || s.type === 'image') && !s.src);
  push(
    'Asset references',
    missingSrc.length === 0 ? 'pass' : 'fail',
    missingSrc.length === 0 ? 'every clip/image scene has a source' : `${missingSrc.length} scene(s) missing src`,
  );

  /* ------------------------------ caption coverage ------------------------------ */

  if (plan.captions && plan.captions.cues.length > 0) {
    const cov = captionCoverage(plan.captions, plan.duration);
    push(
      'Caption coverage',
      cov > 0.55 ? 'pass' : cov > 0.25 ? 'warn' : 'fail',
      `${(cov * 100).toFixed(0)}% of the timeline is captioned (${plan.captions.cues.length} word cues)`,
    );
    const lastCue = plan.captions.cues[plan.captions.cues.length - 1];
    if (lastCue.endMs / 1000 > plan.duration + 0.5) {
      push('Caption bounds', 'warn', `last cue ends ${(lastCue.endMs / 1000 - plan.duration).toFixed(2)}s past the timeline`);
    }
  } else {
    push('Captions', 'pass', 'not requested for this project');
  }

  /* -------------------------------- media scans -------------------------------- */

  if (opts.options?.skipMediaScans) {
    push('Media scans', 'warn', 'frame/audio scans skipped');
  } else {
    // Binary "is this frame black" detection is only trustworthy for *empty*
    // frames. Legitimately dark footage is judged by measured luma instead, so a
    // moody night scene is never reported as a defect.
    try {
      const black = await detectBlackFrames(file, {pixTh: 0.04, picTh: 0.98, minDur: 0.25});
      const totalBlack = black.reduce((a, b) => a + (b.end - b.start), 0);
      push(
        'Black frames',
        totalBlack < 0.3 ? 'pass' : totalBlack < 1.5 ? 'warn' : 'fail',
        black.length === 0
          ? 'no empty (black) frames — every frame has picture'
          : `${black.length} interval(s), ${totalBlack.toFixed(2)}s below luma 10/255`, 
      );
    } catch (e) {
      push('Black frames', 'warn', `scan failed: ${(e as Error).message.split('\n')[0].slice(0, 120)}`);
    }

    try {
      const luma = await frameLumaSeries(file, 2);
      if (luma.length > 0) {
        const min = Math.min(...luma);
        const avg = luma.reduce((a, b) => a + b, 0) / luma.length;
        // longest consecutive run (at 0.5s per sample) below the dark threshold
        const DARK = 12;
        let run = 0;
        let longest = 0;
        for (const v of luma) {
          run = v < DARK ? run + 1 : 0;
          longest = Math.max(longest, run);
        }
        const longestSec = longest / 2;
        push(
          'Exposure',
          longestSec < 0.6 ? 'pass' : longestSec < 1.6 ? 'warn' : 'fail',
          `average luma ${avg.toFixed(0)}/255, darkest ${min.toFixed(0)}/255` +
            (longestSec >= 0.6 ? `, ${longestSec.toFixed(1)}s continuously below luma ${DARK}` : ''),
        );
      }
    } catch (e) {
      push('Exposure', 'warn', `luma scan failed: ${(e as Error).message.split('\n')[0].slice(0, 120)}`);
    }

    if (p.hasAudio) {
      try {
        const peak = await audioPeakDb(file);
        const level: QcLevel = peak.maxDb > -0.5 ? 'fail' : peak.maxDb < -32 ? 'warn' : 'pass';
        push(
          'Audio level',
          level,
          `peak ${peak.maxDb.toFixed(1)} dB, mean ${peak.meanDb.toFixed(1)} dB${peak.maxDb > -0.5 ? ' — clipping' : peak.maxDb < -32 ? ' — very quiet' : ''}`,
        );
      } catch (e) {
        push('Audio level', 'warn', `analysis failed: ${(e as Error).message.split('\n')[0].slice(0, 120)}`);
      }

      try {
        const sil = await detectSilence(file, {noiseDb: -45, minDur: 3});
        const long = sil.filter((s) => s.end - s.start > 5);
        push(
          'Dead air',
          long.length === 0 ? 'pass' : 'warn',
          long.length === 0 ? 'no silence longer than 5s' : `${long.length} passage(s) silent for over 5s`,
        );
      } catch (e) {
        push('Dead air', 'warn', `scan failed: ${(e as Error).message.split('\n')[0].slice(0, 120)}`);
      }
    } else if (plan.audio.length > 0) {
      push('Audio stream', 'fail', `plan has ${plan.audio.length} audio track(s) but the render is silent — the mix was not muxed`);
    }
  }

  const level = checks.reduce<QcLevel>((a, c) => worst(a, c.level), 'pass');
  return {
    checks,
    level,
    durationSec: p.duration,
    width: p.width ?? 0,
    height: p.height ?? 0,
    fps: p.fps ?? 0,
    sizeBytes: stat.size,
  };
}

const ICON: Record<QcLevel, string> = {pass: '✔', warn: '!', fail: '✘'};

export function renderQcReport(report: QcReport, meta: {projectId?: string; file: string; planDuration: number}): string {
  const out: string[] = [];
  out.push(`# QC report — ${report.level.toUpperCase()}`);
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  if (meta.projectId) out.push(`| Project | \`${meta.projectId}\` |`);
  out.push(`| File | \`${meta.file}\` |`);
  out.push(`| Rendered | ${report.durationSec.toFixed(2)}s · ${report.width}×${report.height} @ ${report.fps.toFixed(2)}fps |`);
  out.push(`| Planned | ${meta.planDuration.toFixed(2)}s |`);
  out.push(`| Size | ${(report.sizeBytes / 1_048_576).toFixed(2)} MB |`);
  out.push(`| Verdict | **${report.level}** |`);
  out.push('');
  out.push('| | Check | Result |');
  out.push('|---|---|---|');
  for (const c of report.checks) {
    out.push(`| ${ICON[c.level]} | ${c.name} | ${c.detail} |`);
  }
  out.push('');
  const problems = report.checks.filter((c) => c.level !== 'pass');
  if (problems.length > 0) {
    out.push('## Items to review');
    out.push('');
    for (const c of problems) out.push(`- **${c.name}** (${c.level}) — ${c.detail}`);
    out.push('');
  } else {
    out.push('All checks passed.');
    out.push('');
  }
  return out.join('\n');
}
