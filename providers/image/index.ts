/**
 * Image generation provider — AI-generated still plates for scenes.
 *
 * Adapters (first with a key wins):
 *   1. OpenAI Images   — OPENAI_API_KEY      (gpt-image-1)
 *   2. Stability AI    — STABILITY_API_KEY   (core / sd3)
 *   3. Replicate       — REPLICATE_API_TOKEN (SDXL and friends)
 *
 * When no key is present this provider reports `unavailable`; the pipeline then
 * uses procedural 2D/3D scenes instead (see engine/planner/visuals.ts) rather
 * than pretending an image was generated. Generated stills are then animated
 * for real by the Remotion camera system (Ken Burns / parallax), which is a
 * genuine image→video path that needs no video-model key.
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {ProviderStatus} from '../../engine/types';

export interface ImageRequest {
  prompt: string;
  output: string;
  /** square by default; the composition aspect is applied when animating */
  width?: number;
  height?: number;
  /** negative prompt (Stability/Replicate honour it) */
  negative?: string;
  /** style hint folded into the prompt */
  styleHint?: string;
}

export interface ImageProvider {
  status(): ProviderStatus;
  generate(req: ImageRequest): Promise<string>;
}

const ensureDir = async (p: string) => fs.mkdir(path.dirname(p), {recursive: true});

/* --------------------------------- OpenAI --------------------------------- */

const openaiAspect = (w: number, h: number): string => {
  const r = w / h;
  if (r > 1.3) return '1536x1024';
  if (r < 0.77) return '1024x1536';
  return '1024x1024';
};

class OpenAiImage implements ImageProvider {
  status(): ProviderStatus {
    const key = process.env.OPENAI_API_KEY;
    return {
      name: 'OpenAI Images',
      kind: 'image',
      available: Boolean(key),
      mode: key ? 'api' : 'unavailable',
      detail: key ? 'OPENAI_API_KEY set (gpt-image-1)' : 'OPENAI_API_KEY not set',
    };
  }

  async generate(req: ImageRequest): Promise<string> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');
    const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    await ensureDir(req.output);
    const res = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
        prompt: [req.prompt, req.styleHint].filter(Boolean).join(', '),
        size: openaiAspect(req.width ?? 1024, req.height ?? 1024),
        n: 1,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI images ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {data?: Array<{b64_json?: string; url?: string}>};
    const first = json.data?.[0];
    if (!first) throw new Error('OpenAI images: empty response');
    if (first.b64_json) {
      await fs.writeFile(req.output, Buffer.from(first.b64_json, 'base64'));
      return req.output;
    }
    if (first.url) {
      const img = await fetch(first.url);
      if (!img.ok) throw new Error(`OpenAI image download ${img.status}`);
      await fs.writeFile(req.output, Buffer.from(await img.arrayBuffer()));
      return req.output;
    }
    throw new Error('OpenAI images: no image in response');
  }
}

/* -------------------------------- Stability -------------------------------- */

class StabilityImage implements ImageProvider {
  status(): ProviderStatus {
    const key = process.env.STABILITY_API_KEY;
    return {
      name: 'Stability AI',
      kind: 'image',
      available: Boolean(key),
      mode: key ? 'api' : 'unavailable',
      detail: key ? 'STABILITY_API_KEY set' : 'STABILITY_API_KEY not set',
    };
  }

  async generate(req: ImageRequest): Promise<string> {
    const key = process.env.STABILITY_API_KEY;
    if (!key) throw new Error('STABILITY_API_KEY not set');
    await ensureDir(req.output);
    const form = new FormData();
    form.append('prompt', [req.prompt, req.styleHint].filter(Boolean).join(', '));
    if (req.negative) form.append('negative_prompt', req.negative);
    form.append('output_format', 'png');
    // Stability requires side lengths divisible by 64 within 1024..1536
    const round64 = (n: number) => Math.max(1024, Math.min(1536, Math.round(n / 64) * 64));
    form.append('aspect_ratio', `${round64(req.width ?? 1024)}:${round64(req.height ?? 1024)}`);
    const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
      method: 'POST',
      headers: {Authorization: `Bearer ${key}`, Accept: 'image/*'},
      body: form,
    });
    if (!res.ok) throw new Error(`Stability ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 1024) throw new Error('Stability returned no image data');
    await fs.writeFile(req.output, buf);
    return req.output;
  }
}

/* -------------------------------- Replicate -------------------------------- */

class ReplicateImage implements ImageProvider {
  status(): ProviderStatus {
    const key = process.env.REPLICATE_API_TOKEN;
    return {
      name: 'Replicate (image)',
      kind: 'image',
      available: Boolean(key),
      mode: key ? 'api' : 'unavailable',
      detail: key ? 'REPLICATE_API_TOKEN set' : 'REPLICATE_API_TOKEN not set',
    };
  }

  async generate(req: ImageRequest): Promise<string> {
    const key = process.env.REPLICATE_API_TOKEN;
    if (!key) throw new Error('REPLICATE_API_TOKEN not set');
    await ensureDir(req.output);
    const model = process.env.REPLICATE_IMAGE_MODEL || 'stability-ai/sdxl';
    const start = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'wait'},
      body: JSON.stringify({
        input: {
          prompt: [req.prompt, req.styleHint].filter(Boolean).join(', '),
          ...(req.negative ? {negative_prompt: req.negative} : {}),
          width: req.width ?? 1024,
          height: req.height ?? 1024,
        },
      }),
    });
    if (!start.ok) throw new Error(`Replicate ${start.status}: ${(await start.text()).slice(0, 200)}`);
    let json = (await start.json()) as {id: string; status: string; output?: string[] | string; error?: string};
    // poll until terminal (Prefer: wait handles most cases, but be safe)
    for (let i = 0; i < 90 && !['succeeded', 'failed', 'canceled'].includes(json.status); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${json.id}`, {
        headers: {Authorization: `Bearer ${key}`},
      });
      if (!poll.ok) throw new Error(`Replicate poll ${poll.status}`);
      json = (await poll.json()) as typeof json;
    }
    if (json.status !== 'succeeded') throw new Error(`Replicate image ${json.status}: ${json.error ?? ''}`);
    const url = Array.isArray(json.output) ? json.output[0] : json.output;
    if (!url) throw new Error('Replicate image: empty output');
    const img = await fetch(url);
    if (!img.ok) throw new Error(`Replicate image download ${img.status}`);
    await fs.writeFile(req.output, Buffer.from(await img.arrayBuffer()));
    return req.output;
  }
}

/* -------------------------------- selection -------------------------------- */

export const IMAGE_PROVIDERS: Array<() => ImageProvider> = [
  () => new OpenAiImage(),
  () => new StabilityImage(),
  () => new ReplicateImage(),
];

export function imageStatuses(): ProviderStatus[] {
  return IMAGE_PROVIDERS.map((f) => f().status());
}

/** First available image provider (or null with the reason why). */
export function getImageProvider(): {provider: ImageProvider | null; why: string} {
  const statuses = imageStatuses();
  for (const make of IMAGE_PROVIDERS) {
    const p = make();
    if (p.status().available) return {provider: p, why: ''};
  }
  return {
    provider: null,
    why: `no image provider configured (${statuses.map((s) => s.detail).join('; ')}) — procedural scenes will be used instead`,
  };
}

/**
 * Build a scene image prompt from plan data. Deterministic: the planner's
 * `visual` description plus the style's art direction, no LLM round-trip.
 */
export function sceneImagePrompt(visual: string, opts: {style?: string; aspect?: string; mood?: string} = {}): string {
  const parts = [
    visual,
    opts.mood ? `${opts.mood} mood` : '',
    'cinematic composition, coherent lighting, no text, no watermark',
    opts.style ? `${opts.style} art direction` : '',
    opts.aspect ? `${opts.aspect} aspect` : '',
  ];
  return parts.filter(Boolean).join(', ');
}
