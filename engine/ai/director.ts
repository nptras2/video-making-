/**
 * LLM script drafting — used only where a script is *required* but the user
 * supplied none (MODE E, prompt-only). Without an LLM this returns null and the
 * pipeline builds a typographic motion piece from the prompt instead of
 * inventing narration and passing it off as the user's content.
 */
import {llmConfig} from './index';
import type {Brief} from '../planner/local';

export interface DraftOptions {
  targetWords?: number;
  tone?: string;
}

export interface DraftResult {
  text: string | null;
  reason?: string;
  provider?: string;
}

const SYSTEM = `You are a short-form video writer. Write ONLY the narration script — no scene headings, no shot notes, no markdown, no quotes.
Rules: spoken register, short sentences, one idea per sentence, no emoji, no stage directions.
Match the requested tone and length. End on a clear closing line.`;

export async function draftNarration(brief: Brief, opts: DraftOptions = {}): Promise<DraftResult> {
  const cfg = llmConfig();
  if (!cfg) {
    return {
      text: null,
      reason: 'no LLM credentials (set OPENAI_API_KEY or LLM_API_KEY + LLM_BASE_URL)',
    };
  }
  const targetWords = opts.targetWords ?? Math.max(30, Math.round((brief.duration ?? 30) * 2.5));
  const prompt = [
    `WRITE A NARRATION SCRIPT (~${targetWords} words).`,
    brief.prompt ? `BRIEF: ${brief.prompt}` : '',
    brief.topic ? `TOPIC: ${brief.topic}` : '',
    brief.title ? `WORKING TITLE: ${brief.title}` : '',
    opts.tone ? `TONE: ${opts.tone}` : '',
    `Target length: ${brief.duration ?? 30} seconds of spoken audio.`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.7,
        messages: [
          {role: 'system', content: SYSTEM},
          {role: 'user', content: prompt},
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const json = (await res.json()) as {choices?: Array<{message?: {content?: string}}>};
    const text = (json.choices?.[0]?.message?.content ?? '').trim();
    if (text.length < 20) throw new Error('LLM returned a too-short script');
    return {text, provider: `${cfg.source}:${cfg.model}`};
  } catch (e) {
    return {text: null, reason: (e as Error).message.split('\n')[0].slice(0, 200)};
  }
}
