/**
 * Stock media provider — real B-roll, photos and footage from stock APIs.
 *
 * Keys are optional; when none is present this provider reports `unavailable`
 * and the planner simply proceeds without stock media (procedural scenes
 * already carry the video). It never fabricates asset URLs or fakes a download.
 *
 *   providers/media
 *    ├── Pexels      (PEXELS_API_KEY)     — photos + video
 *    ├── Pixabay     (PIXABAY_API_KEY)    — photos + video
 *    └── Unsplash    (UNSPLASH_ACCESS_KEY) — photos
 *
 * Attribution: Pexels/Pixabay/Unsplash do not require attribution for use, but
 * `credits` is always returned so the storyboard can list sources.
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {ProviderStatus} from '../../engine/types';

export type StockKind = 'photo' | 'video';

export interface StockAsset {
  /** stable id from the source API */
  id: string;
  kind: StockKind;
  provider: string;
  /** direct media URL (video files link the best-fit rendition) */
  url: string;
  width?: number;
  height?: number;
  durationSec?: number;
  /** human-readable credit line */
  credit: string;
  /** page URL for reference */
  pageUrl?: string;
  /** search query that surfaced it */
  query: string;
}

export interface StockSearchOptions {
  kind: StockKind;
  perPage?: number;
  /** 'portrait' | 'landscape' | 'square' — mapped per provider */
  orientation?: 'portrait' | 'landscape' | 'square';
  minWidth?: number;
}

/* ------------------------------- availability ------------------------------- */

export interface StockProviderStatus extends ProviderStatus {
  kinds: StockKind[];
}

const key = (name: string): string => process.env[name] ?? '';

export function stockStatuses(): StockProviderStatus[] {
  return [
    {
      name: 'Pexels',
      kind: 'image',
      available: Boolean(key('PEXELS_API_KEY')),
      mode: key('PEXELS_API_KEY') ? 'api' : 'unavailable',
      detail: key('PEXELS_API_KEY') ? 'PEXELS_API_KEY set' : 'PEXELS_API_KEY not set',
      kinds: ['photo', 'video'],
    },
    {
      name: 'Pixabay',
      kind: 'image',
      available: Boolean(key('PIXABAY_API_KEY')),
      mode: key('PIXABAY_API_KEY') ? 'api' : 'unavailable',
      detail: key('PIXABAY_API_KEY') ? 'PIXABAY_API_KEY set' : 'PIXABAY_API_KEY not set',
      kinds: ['photo', 'video'],
    },
    {
      name: 'Unsplash',
      kind: 'image',
      available: Boolean(key('UNSPLASH_ACCESS_KEY')),
      mode: key('UNSPLASH_ACCESS_KEY') ? 'api' : 'unavailable',
      detail: key('UNSPLASH_ACCESS_KEY') ? 'UNSPLASH_ACCESS_KEY set' : 'UNSPLASH_ACCESS_KEY not set',
      kinds: ['photo'],
    },
  ];
}

export function anyStockAvailable(): boolean {
  return stockStatuses().some((s) => s.available);
}

/* --------------------------------- Pexels --------------------------------- */

const pexels = async (q: string, opts: StockSearchOptions): Promise<StockAsset[]> => {
  const keyVal = key('PEXELS_API_KEY');
  if (!keyVal) return [];
  const perPage = Math.min(30, opts.perPage ?? 6);
  const endpoint = opts.kind === 'photo' ? 'v1/search' : 'videos/search';
  const url = new URL(`https://api.pexels.com/${endpoint}`);
  url.searchParams.set('query', q);
  url.searchParams.set('per_page', String(perPage));
  if (opts.orientation) url.searchParams.set('orientation', opts.orientation);
  const res = await fetch(url, {headers: {Authorization: keyVal}});
  if (!res.ok) throw new Error(`Pexels ${res.status}: ${(await res.text()).slice(0, 180)}`);
  const json = (await res.json()) as {
    photos?: Array<{id: number; width: number; height: number; url: string; photographer: string; src: Record<string, string>}>;
    videos?: Array<{
      id: number;
      width: number;
      height: number;
      duration: number;
      url: string;
      user: {name: string};
      video_files: Array<{link: string; width: number; height: number; quality: string; file_type: string}>;
    }>;
  };

  if (opts.kind === 'photo') {
    return (json.photos ?? [])
      .filter((p) => (opts.minWidth ? p.width >= opts.minWidth : true))
      .map((p) => ({
        id: `pexels-photo-${p.id}`,
        kind: 'photo' as const,
        provider: 'Pexels',
        url: p.src.large2x ?? p.src.large ?? p.src.original,
        width: p.width,
        height: p.height,
        credit: `Photo by ${p.photographer} on Pexels`,
        pageUrl: p.url,
        query: q,
      }));
  }
  return (json.videos ?? []).map((v) => {
    const best =
      v.video_files
        .filter((f) => f.file_type === 'video/mp4')
        .sort((a, b) => Math.abs(a.width - 1920) - Math.abs(b.width - 1920))[0] ?? v.video_files[0];
    return {
      id: `pexels-video-${v.id}`,
      kind: 'video' as const,
      provider: 'Pexels',
      url: best?.link ?? '',
      width: v.width,
      height: v.height,
      durationSec: v.duration,
      credit: `Video by ${v.user?.name ?? 'unknown'} on Pexels`,
      pageUrl: v.url,
      query: q,
    };
  }).filter((a) => a.url);
};

/* --------------------------------- Pixabay --------------------------------- */

const pixabay = async (q: string, opts: StockSearchOptions): Promise<StockAsset[]> => {
  const keyVal = key('PIXABAY_API_KEY');
  if (!keyVal) return [];
  const perPage = Math.min(20, opts.perPage ?? 6);
  const base = opts.kind === 'photo' ? 'https://pixabay.com/api/' : 'https://pixabay.com/api/videos/';
  const url = new URL(base);
  url.searchParams.set('key', keyVal);
  url.searchParams.set('q', q);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('safesearch', 'true');
  const orientation = opts.orientation === 'portrait' ? 'vertical' : opts.orientation === 'landscape' ? 'horizontal' : undefined;
  if (orientation) url.searchParams.set('orientation', orientation);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay ${res.status}: ${(await res.text()).slice(0, 180)}`);
  const json = (await res.json()) as {
    hits?: Array<{
      id: number;
      pageURL: string;
      user: string;
      imageWidth?: number;
      imageHeight?: number;
      largeImageURL?: string;
      webformatURL?: string;
      videos?: Record<string, {url: string; width: number; height: number}>;
      duration?: number;
    }>;
  };
  if (opts.kind === 'photo') {
    return (json.hits ?? []).map((h) => ({
      id: `pixabay-photo-${h.id}`,
      kind: 'photo' as const,
      provider: 'Pixabay',
      url: h.largeImageURL ?? h.webformatURL ?? '',
      width: h.imageWidth,
      height: h.imageHeight,
      credit: `Image by ${h.user} on Pixabay`,
      pageUrl: h.pageURL,
      query: q,
    })).filter((a) => a.url);
  }
  return (json.hits ?? []).map((h) => {
    const renditions = Object.values(h.videos ?? {});
    const best = renditions.sort((a, b) => Math.abs(a.width - 1920) - Math.abs(b.width - 1920))[0];
    return {
      id: `pixabay-video-${h.id}`,
      kind: 'video' as const,
      provider: 'Pixabay',
      url: best?.url ?? '',
      width: best?.width,
      height: best?.height,
      durationSec: h.duration,
      credit: `Video by ${h.user} on Pixabay`,
      pageUrl: h.pageURL,
      query: q,
    };
  }).filter((a) => a.url);
};

/* --------------------------------- Unsplash --------------------------------- */

const unsplash = async (q: string, opts: StockSearchOptions): Promise<StockAsset[]> => {
  const keyVal = key('UNSPLASH_ACCESS_KEY');
  if (!keyVal) return [];
  if (opts.kind === 'video') return [];
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', q);
  url.searchParams.set('per_page', String(Math.min(20, opts.perPage ?? 6)));
  if (opts.orientation) url.searchParams.set('orientation', opts.orientation);
  const res = await fetch(url, {headers: {Authorization: `Client-ID ${keyVal}`}});
  if (!res.ok) throw new Error(`Unsplash ${res.status}: ${(await res.text()).slice(0, 180)}`);
  const json = (await res.json()) as {
    results?: Array<{id: string; width: number; height: number; links: {html: string; download: string}; user: {name: string}; urls: {regular: string; full: string}}>;
  };
  return (json.results ?? []).map((r) => ({
    id: `unsplash-${r.id}`,
    kind: 'photo' as const,
    provider: 'Unsplash',
    url: r.urls.full ?? r.urls.regular,
    width: r.width,
    height: r.height,
    credit: `Photo by ${r.user?.name ?? 'unknown'} on Unsplash`,
    pageUrl: r.links?.html,
    query: q,
  })).filter((a) => a.url);
};

/* --------------------------------- search --------------------------------- */

export interface StockSearchResult {
  assets: StockAsset[];
  /** provider failures collected so the caller can report them honestly */
  errors: string[];
  attempted: string[];
}

/**
 * Search every configured provider in parallel and return a merged, deduped
 * set (best-resolution first). Errors are collected, never thrown: a failing
 * provider must not abort a production run.
 */
export async function searchStock(q: string, opts: StockSearchOptions): Promise<StockSearchResult> {
  const providers: Array<{name: string; run: () => Promise<StockAsset[]>}> = [
    {name: 'Pexels', run: () => pexels(q, opts)},
    {name: 'Pixabay', run: () => pixabay(q, opts)},
    {name: 'Unsplash', run: () => unsplash(q, opts)},
  ];
  const errors: string[] = [];
  const attempted: string[] = [];
  const settled = await Promise.all(
    providers.map(async (p) => {
      const st = stockStatuses().find((s) => s.name === p.name)!;
      if (!st.available) return [] as StockAsset[];
      if (!st.kinds.includes(opts.kind)) return [] as StockAsset[];
      attempted.push(p.name);
      try {
        return await p.run();
      } catch (e) {
        errors.push(`${p.name}: ${(e as Error).message}`);
        return [] as StockAsset[];
      }
    }),
  );
  const minW = opts.minWidth ?? 0;
  const merged = settled
    .flat()
    .filter((a) => (a.width ?? 0) >= minW)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const seen = new Set<string>();
  const deduped = merged.filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
  return {assets: deduped, errors, attempted};
}

/** Download a stock asset to disk. Returns the written path. */
export async function downloadStock(asset: StockAsset, destPath: string): Promise<string> {
  if (!asset.url) throw new Error(`stock asset ${asset.id} has no url`);
  await fs.mkdir(path.dirname(destPath), {recursive: true});
  const res = await fetch(asset.url, {redirect: 'follow'});
  if (!res.ok) throw new Error(`download ${asset.id} failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 1024) throw new Error(`download ${asset.id} returned ${buf.byteLength} bytes`);
  await fs.writeFile(destPath, buf);
  return destPath;
}

/**
 * Turn a narration sentence into a stock search query: strips stopwords and
 * keeps the most concrete nouns. Deterministic, no LLM required.
 */
const STOPWORDS = new Set(
  ('a an the and or but if then than that this these those is are was were be been being am do does did done have has had having ' +
   'i you he she it we they me him her us them my your his its our their to of in on at by for with from into over under again ' +
   'further once here there when where why how all any both each few more most other some such no nor not only own same so too ' +
   'very can will just should now about after before because while during without within along across also like get got make makes ' +
   'made go goes going say says said know knows knew think thinks thought see sees saw come comes came want wants take takes')
    .split(' '),
);

export function narrationToQuery(text: string, maxWords = 4): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  const picked = words.slice(0, maxWords);
  return picked.join(' ') || text.split(/\s+/).slice(0, 3).join(' ');
}
