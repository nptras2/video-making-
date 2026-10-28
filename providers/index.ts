/**
 * Provider registry — one place that answers "what can this machine actually do?"
 *
 * `video doctor` prints this; the pipeline stores it in PROJECT_STATE.json so a
 * finished project records exactly which capabilities were local, which were
 * API-backed, and which were missing at production time.
 */
import type {ProviderStatus} from '../engine/types';
import {getSttProvider} from './stt/index';
import {getVoiceProvider} from './voice/index';
import {imageStatuses} from './image/index';
import {videoStatuses} from './video/index';
import {stockStatuses} from './media/index';
import {musicStatuses} from './music/index';
import {llmStatus} from '../engine/ai/index';

export interface CapabilityReport {
  statuses: ProviderStatus[];
  /** true when a capability has no provider at all */
  missing: string[];
  /** what the engine does instead of the missing capability */
  fallbacks: string[];
}

/**
 * Probe every provider. STT/TTS probing can install whisper.cpp on first run,
 * so pass `deep: false` for a fast status board that skips those checks.
 */
export async function capabilityReport(opts: {deep?: boolean} = {}): Promise<CapabilityReport> {
  const deep = opts.deep ?? true;
  const statuses: ProviderStatus[] = [];

  if (deep) {
    const stt = await getSttProvider();
    statuses.push(stt.status);
    const tts = await getVoiceProvider();
    statuses.push(tts.status);
  } else {
    statuses.push({
      name: 'speech-to-text',
      kind: 'stt',
      available: false,
      mode: 'unavailable',
      detail: 'skipped (run `video doctor` for the full probe)',
    });
    statuses.push({
      name: 'text-to-speech',
      kind: 'tts',
      available: false,
      mode: 'unavailable',
      detail: 'skipped (run `video doctor` for the full probe)',
    });
  }

  statuses.push(...imageStatuses(), ...videoStatuses(), ...stockStatuses(), ...musicStatuses());

  const llm = llmStatus();
  statuses.push({
    name: llm.name,
    kind: 'planner',
    available: llm.available,
    mode: llm.available ? 'api' : 'local',
    detail: llm.detail,
  });

  const missing: string[] = [];
  const fallbacks: string[] = [];
  const hasImageGen = imageStatuses().some((s) => s.available);
  const hasVideoGen = videoStatuses().some((s) => s.available);
  const hasStock = stockStatuses().some((s) => s.available);

  if (!hasImageGen) {
    missing.push('AI image generation (no key)');
    fallbacks.push('procedural 2D parallax scenes + R3F 3D motion graphics, drawn from the plan');
  }
  if (!hasVideoGen) {
    missing.push('AI video generation (no key)');
    fallbacks.push('camera moves over stills, procedural animation, and FFmpeg editing of real footage');
  }
  if (!hasStock) {
    missing.push('stock photo/video search (no key)');
    fallbacks.push('supplied media only — no stock B-roll is fetched');
  }

  return {statuses, missing, fallbacks};
}

/** Compact console table for `video doctor`. */
export function formatCapabilities(report: CapabilityReport): string {
  const pad = Math.max(...report.statuses.map((s) => s.name.length), 12);
  const lines = report.statuses.map((s) => {
    const mark = s.available ? (s.mode === 'local' ? '●' : '◆') : '○';
    const tag = s.available ? s.mode : 'unavailable';
    return `${mark} ${s.name.padEnd(pad)}  ${tag.padEnd(12)} ${s.detail}`;
  });
  const legend = '\n◆ api-backed   ● local/offline   ○ unavailable';
  if (report.missing.length === 0) return lines.join('\n') + legend;
  const fb = report.missing.map((m, i) => `! ${m}\n    fallback: ${report.fallbacks[i]}`);
  return lines.join('\n') + legend + '\n\nMissing capabilities:\n' + fb.join('\n');
}
