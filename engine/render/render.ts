/**
 * Render engine — bundles the Remotion project with the *project's* public
 * directory (so staticFile() resolves staged assets) and renders the single
 * dynamic `Main` composition from a VideoPlan.
 *
 * Bundles are memoized per publicDir: preview + final + thumbnail in one run
 * pay the webpack cost once. Audio is deliberately muted here — FFmpeg builds
 * the exact master mix (cuts, ducking, loudness) and muxes it afterwards.
 */
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import type {VideoPlan} from '../types';
import {ROOT} from '../project/manager';

const ENTRY = path.join(ROOT, 'src', 'index.ts');

export interface RenderOptions {
  plan: VideoPlan;
  publicDir: string;
  output: string;
  /** 0.5 = half-res preview */
  scale?: number;
  crf?: number;
  /** override composition id (default "Main") */
  compositionId?: string;
  onProgress?: (progress01: number) => void;
  logLevel?: 'error' | 'warn' | 'info' | 'verbose';
}

const bundleCache = new Map<string, Promise<string>>();

const getServeUrl = async (publicDir: string): Promise<string> => {
  const key = `${ENTRY}|${publicDir}`;
  let existing = bundleCache.get(key);
  if (!existing) {
    existing = bundle({
      entryPoint: ENTRY,
      publicDir,
      onProgress: () => undefined,
    }).catch((err) => {
      bundleCache.delete(key);
      throw err;
    });
    bundleCache.set(key, existing);
  }
  return existing;
};

const chromiumOptions =
  process.platform === 'win32'
    ? ({gl: 'angle'} as const)
    : ({gl: 'swangle'} as const);

export async function renderPlan(opts: RenderOptions): Promise<{output: string; frames: number; seconds: number}> {
  const {plan, publicDir, output} = opts;
  const serveUrl = await getServeUrl(publicDir);
  const inputProps = {plan};
  const compositionId = opts.compositionId ?? 'Main';

  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps,
    logLevel: opts.logLevel ?? 'error',
  });

  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    codec: 'h264',
    outputLocation: output,
    scale: opts.scale ?? 1,
    crf: opts.crf ?? 18,
    muted: true,
    enforceAudioTrack: false,
    timeoutInMilliseconds: 120_000,
    chromiumOptions,
    logLevel: opts.logLevel ?? 'error',
    onProgress: ({progress}) => opts.onProgress?.(progress),
  });

  return {output, frames: composition.durationInFrames, seconds: composition.durationInFrames / composition.fps};
}

/** Render a single frame as JPEG (used for thumbnails before final render). */
export async function renderStillFrame(opts: {
  plan: VideoPlan;
  publicDir: string;
  output: string;
  frame?: number;
}): Promise<string> {
  const serveUrl = await getServeUrl(opts.publicDir);
  const inputProps = {plan: opts.plan};
  const composition = await selectComposition({serveUrl, id: 'Main', inputProps, logLevel: 'error'});
  await renderStill({
    composition,
    serveUrl,
    inputProps,
    output: opts.output,
    frame: opts.frame ?? Math.floor(composition.durationInFrames * 0.25),
    chromiumOptions,
    scale: 1,
    logLevel: 'error',
  });
  return opts.output;
}