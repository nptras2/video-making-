/**
 * Voice provider abstraction (TTS / narration).
 *
 * Local-first: Windows System.Speech runs offline with no key. Cloud voices
 * (ElevenLabs, OpenAI TTS) are optional adapters selected only when their key
 * is present. Missing key ⇒ unavailable, never a fake voice.
 *
 * VoiceProvider
 *  ├── LocalWindowsTts   (offline, env-free)
 *  ├── ElevenLabsTts     (ELEVENLABS_API_KEY)
 *  └── OpenAiTts         (OPENAI_API_KEY, OPENAI_BASE_URL)
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {ProviderStatus} from '../../engine/types';

const execFileP = promisify(execFile);

export interface VoiceOptions {
  /** 0.5..2 speaking rate hint (local provider) */
  rate?: number;
  voice?: string;
  language?: string;
}

export interface VoiceProvider {
  status(): Promise<ProviderStatus>;
  /** Synthesize `text` to a WAV file; returns the file path. */
  speak(text: string, outPath: string, opts?: VoiceOptions): Promise<string>;
}

/* --------------------------- local Windows TTS --------------------------- */

class LocalWindowsTts implements VoiceProvider {
  private checked = false;
  private ok = false;
  private error = '';

  private async check(): Promise<boolean> {
    if (this.checked) return this.ok;
    this.checked = true;
    if (process.platform !== 'win32') {
      this.error = 'System.Speech is only available on Windows';
      return false;
    }
    try {
      await execFileP('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices().Count',
      ], {timeout: 30_000});
      this.ok = true;
    } catch (e) {
      this.error = (e as Error).message.split('\n')[0].slice(0, 160);
    }
    return this.ok;
  }

  async status(): Promise<ProviderStatus> {
    const ok = await this.check();
    return {
      name: 'Windows System.Speech',
      kind: 'tts',
      available: ok,
      mode: ok ? 'local' : 'unavailable',
      detail: ok ? 'offline system voices' : this.error,
    };
  }

  async speak(text: string, outPath: string, opts?: VoiceOptions): Promise<string> {
    if (!(await this.check())) throw new Error(`Local TTS unavailable: ${this.error}`);
    await fs.mkdir(path.dirname(outPath), {recursive: true});
    const rate = Math.max(-10, Math.min(10, Math.round(((opts?.rate ?? 1) - 1) * 10)));
    // Text travels via env var to avoid every quoting/escaping pitfall.
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      "$s.SetOutputToWaveFile($env:ENGINE_TTS_OUT)",
      `$s.Rate = ${rate}`,
      ...(opts?.voice ? [`$s.SelectVoice($env:ENGINE_TTS_VOICE)`] : []),
      '$t = [System.Environment]::GetEnvironmentVariable("ENGINE_TTS_TEXT")',
      '$s.Speak($t)',
      '$s.Dispose()',
      'Write-Output "ok"',
    ].join('; ');
    await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: Math.max(60_000, text.length * 120),
      env: {...process.env, ENGINE_TTS_OUT: outPath, ENGINE_TTS_TEXT: text, ...(opts?.voice ? {ENGINE_TTS_VOICE: opts.voice} : {})},
    });
    const st = await fs.stat(outPath);
    if (st.size < 128) throw new Error('Local TTS produced an empty file');
    return outPath;
  }
}

/* ------------------------------ ElevenLabs ------------------------------ */

class ElevenLabsTts implements VoiceProvider {
  private key = process.env.ELEVENLABS_API_KEY ?? '';
  private voiceId = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'; // George (narrative)

  async status(): Promise<ProviderStatus> {
    return {
      name: 'ElevenLabs',
      kind: 'tts',
      available: Boolean(this.key),
      mode: this.key ? 'api' : 'unavailable',
      detail: this.key ? 'ELEVENLABS_API_KEY set' : 'ELEVENLABS_API_KEY not set',
    };
  }

  async speak(text: string, outPath: string, opts?: VoiceOptions): Promise<string> {
    if (!this.key) throw new Error('ELEVENLABS_API_KEY not set');
    await fs.mkdir(path.dirname(outPath), {recursive: true});
    const voice = opts?.voice ?? this.voiceId;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'xi-api-key': this.key},
      body: JSON.stringify({text, model_id: 'eleven_v4', voice_settings: {stability: 0.5, similarity_boost: 0.75}}),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(outPath, buf);
    return outPath;
  }
}

/* ------------------------------- OpenAI TTS ------------------------------- */

class OpenAiTts implements VoiceProvider {
  private key = process.env.OPENAI_API_KEY ?? '';

  async status(): Promise<ProviderStatus> {
    return {
      name: 'OpenAI TTS',
      kind: 'tts',
      available: Boolean(this.key),
      mode: this.key ? 'api' : 'unavailable',
      detail: this.key ? 'OPENAI_API_KEY set' : 'OPENAI_API_KEY not set',
    };
  }

  async speak(text: string, outPath: string, opts?: VoiceOptions): Promise<string> {
    if (!this.key) throw new Error('OPENAI_API_KEY not set');
    await fs.mkdir(path.dirname(outPath), {recursive: true});
    const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: opts?.voice ?? 'alloy',
        input: text,
        response_format: 'wav',
      }),
    });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
    return outPath;
  }
}

/* ------------------------------ selection ------------------------------ */

let chosen: VoiceProvider | null = null;

export async function getVoiceProvider(): Promise<{provider: VoiceProvider | null; status: ProviderStatus}> {
  const forced = process.env.TTS_PROVIDER;
  const candidates: VoiceProvider[] =
    forced === 'elevenlabs'
      ? [new ElevenLabsTts()]
      : forced === 'openai'
        ? [new OpenAiTts()]
        : forced === 'local'
          ? [new LocalWindowsTts()]
          : [new ElevenLabsTts(), new OpenAiTts(), new LocalWindowsTts()];

  for (const c of candidates) {
    const s = await c.status();
    if (s.available) {
      chosen = c;
      return {provider: c, status: s};
    }
  }
  return {
    provider: null,
    status: {name: 'text-to-speech', kind: 'tts', available: false, mode: 'unavailable', detail: 'no provider available'},
  };
}

export function currentVoiceName(): string {
  return chosen ? 'selected' : 'none';
}