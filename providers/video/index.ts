/**
 * Generative video provider — text-to-video / image-to-video clips.
 *
 * Adapters (first with a key wins):
 *   1. Luma Dream Machine — LUMA_API_KEY
 *   2. Runway             — RUNWAY_API_KEY
 *   3. Replicate          — REPLICATE_API_TOKEN (any video model slug)
 *
 * IMPORTANT — this is the one capability that genuinely needs a paid external
 * service. With no key, `status()` reports `unavailable` and the pipeline uses
 * real local alternatives instead:
 *
 *   • still image + Remotion camera move  →  motion from any photo (no model)
 *   • procedural 2D parallax scenes       →  illustrated animation
 *   • R3F 3D motion graphics              →  dimensional motion
 *   • FFmpeg trim/reframe/grade           →  video-to-video editing of real footage
 *
 * Nothing here fabricates a generated clip.
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {ProviderStatus} from '../../engine/types';

export interface VideoRequest {
  prompt: string;
  output: string;
  /** image-to-video: local still that seeds the first frame */
  imagePath?: string;
  durationSec?: number;
  aspect?: '16:9' | '9:16' | '1:1';
}

export interface VideoProvider {
  status(): ProviderStatus;
  generate(req: VideoRequest): Promise<string>;
}

const ensureDir = async (p: string) => fs.mkdir(path.dirname(p), {recursive: true});

const download = async (url: string, output: string, headers: Record<string, string> = {}): Promise<string> => {
  await ensureDir(output);
  const res = await fetch(url, {headers});
  if (!res.ok) throw new Error(`video download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 4096) throw new Error(`video download too small (${buf.byteLength} bytes)`);
  await fs.writeFile(output, buf);
  return output;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------- Luma ---------------------------------- */

class LumaVideo implements VideoProvider {
  status(): ProviderStatus {
    const key = process.env.LUMA_API_KEY;
    return {
      name: 'Luma Dream Machine',
      kind: 'video',
      available: Boolean(key),
      mode: key ? 'api' : 'unavailable',
      detail: key ? 'LUMA_API_KEY set' : 'LUMA_API_KEY not set',
    };
  }

  async generate(req: VideoRequest): Promise<string> {
    const key = process.env.LUMA_API_KEY;
    if (!key) throw new Error('LUMA_API_KEY not set');
    await ensureDir(req.output);
    let imagePayload: Record<string, string> | undefined;
    if (req.imagePath) {
      const b64 = (await fs.readFile(req.imagePath)).toString('base64');
      imagePayload = {type: 'image', data: b64};
    }
    const res = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
      method: 'POST',
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        prompt: req.prompt,
        ...(imagePayload ? {keyframes: {frame0: imagePayload}} : {}),
        aspect_ratio: req.aspect ?? '16:9',
        ...(req.durationSec ? {duration: `${Math.min(9, Math.max(5, Math.round(req.durationSec)))}s`} : {}),
      }),
    });
    if (!res.ok) throw new Error(`Luma ${res.status}: ${(await res.text()).slice(0, 200)}`);
    let job = (await res.json()) as {id: string; state: string; assets?: {video?: string}; failure_reason?: string};
    for (let i = 0; i < 120 && !['completed', 'failed'].includes(job.state); i++) {
      await sleep(3000);
      const poll = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${job.id}`, {
        headers: {Authorization: `Bearer ${key}`},
      });
      if (!poll.ok) throw new Error(`Luma poll ${poll.status}`);
      job = (await poll.json()) as typeof job;
    }
    if (job.state !== 'completed' || !job.assets?.video) {
      throw new Error(`Luma ${job.state}: ${job.failure_reason ?? 'no asset'}`);
    }
    return download(job.assets.video, req.output);
  }
}

/* --------------------------------- Runway --------------------------------- */

class RunwayVideo implements VideoProvider {
  status(): ProviderStatus {
    const key = process.env.RUNWAY_API_KEY;
    return {
      name: 'Runway',
      kind: 'video',
      available: Boolean(key),
      mode: key ? 'api' : 'unavailable',
      detail: key ? 'RUNWAY_API_KEY set' : 'RUNWAY_API_KEY not set',
    };
  }

  async generate(req: VideoRequest): Promise<string> {
    const key = process.env.RUNWAY_API_KEY;
    if (!key) throw new Error('RUNWAY_API_KEY not set');
    await ensureDir(req.output);
    const res = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Runway-Version': '2024-11-06',
      },
      body: JSON.stringify({
        model: process.env.RUNWAY_MODEL || 'gen4_turbo',
        promptText: req.prompt,
        ratio: req.aspect === '9:16' ? '720:1280' : '1280:720',
        duration: Math.min(10, Math.max(5, Math.round(req.durationSec ?? 5))),
        ...(req.imagePath
          ? {promptImage: `data:image/png;base64,${(await fs.readFile(req.imagePath)).toString('base64')}`}
          : {}),
      }),
    });
    if (!res.ok) throw new Error(`Runway ${res.status}: ${(await res.text()).slice(0, 200)}`);
    let job = (await res.json()) as {id: string; status: string; output?: string[]; failure?: string};
    for (let i = 0; i < 150 && !['SUCCEEDED', 'FAILED'].includes(job.status); i++) {
      await sleep(3000);
      const poll = await fetch(`https://api.dev.runwayml.com/v1/tasks/${job.id}`, {
        headers: {Authorization: `Bearer ${key}`, 'X-Runway-Version': '2024-11-06'},
      });
      if (!poll.ok) throw new Error(`Runway poll ${poll.status}`);
      job = (await poll.json()) as typeof job;
    }
    if (job.status !== 'SUCCEEDED' || !job.output?.[0]) throw new Error(`Runway ${job.status}: ${job.failure ?? ''}`);
    return download(job.output[0], req.output);
  }
}

/* -------------------------------- Replicate -------------------------------- */

class ReplicateVideo implements VideoProvider {
  status(): ProviderStatus {
    const key = process.env.REPLICATE_API_TOKEN;
    return {
      name: 'Replicate (video)',
      kind: 'video',
      available: Boolean(key),
      mode: key ? 'api' : 'unavailable',
      detail: key ? 'REPLICATE_API_TOKEN set' : 'REPLICATE_API_TOKEN not set',
    };
  }

  async generate(req: VideoRequest): Promise<string> {
    const key = process.env.REPLICATE_API_TOKEN;
    if (!key) throw new Error('REPLICATE_API_TOKEN not set');
    await ensureDir(req.output);
    const model = process.env.REPLICATE_VIDEO_MODEL || 'minimax/video-01';
    let imageData: string | undefined;
    if (req.imagePath) {
      imageData = `data:image/png;base64,${(await fs.readFile(req.imagePath)).toString('base64')}`;
    }
    const start = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'wait'},
      body: JSON.stringify({
        input: {prompt: req.prompt, ...(imageData ? {first_frame_image: imageData} : {})},
      }),
    });
    if (!start.ok) throw new Error(`Replicate ${start.status}: ${(await start.text()).slice(0, 200)}`);
    let json = (await start.json()) as {id: string; status: string; output?: string | string[]; error?: string};
    for (let i = 0; i < 150 && !['succeeded', 'failed', 'canceled'].includes(json.status); i++) {
      await sleep(3000);
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${json.id}`, {
        headers: {Authorization: `Bearer ${key}`},
      });
      if (!poll.ok) throw new Error(`Replicate poll ${poll.status}`);
      json = (await poll.json()) as typeof json;
    }
    if (json.status !== 'succeeded') throw new Error(`Replicate video ${json.status}: ${json.error ?? ''}`);
    const url = Array.isArray(json.output) ? json.output[0] : json.output;
    if (!url) throw new Error('Replicate video: empty output');
    return download(url, req.output);
  }
}

/* -------------------------------- selection -------------------------------- */

export const VIDEO_PROVIDERS: Array<() => VideoProvider> = [
  () => new LumaVideo(),
  () => new RunwayVideo(),
  () => new ReplicateVideo(),
];

export function videoStatuses(): ProviderStatus[] {
  return VIDEO_PROVIDERS.map((f) => f().status());
}

export function getVideoProvider(): {provider: VideoProvider | null; why: string} {
  for (const make of VIDEO_PROVIDERS) {
    const p = make();
    if (p.status().available) return {provider: p, why: ''};
  }
  return {
    provider: null,
    why:
      'no video-generation key set (LUMA_API_KEY / RUNWAY_API_KEY / REPLICATE_API_TOKEN). ' +
      'Local alternatives in use: Remotion camera moves on stills, procedural 2D parallax scenes, ' +
      'R3F 3D motion graphics, and FFmpeg-based editing of real footage.',
  };
}
