/** Smoke test: local TTS → local whisper.cpp STT roundtrip. */
import path from 'node:path';
import {getVoiceProvider} from '../providers/voice/index';
import {getSttProvider, wordsToCues, wordsToSegments} from '../providers/stt/index';

const main = async () => {
  const wav = path.resolve('outputs/tts-smoke.wav');

  const tts = await getVoiceProvider();
  console.log('TTS status:', JSON.stringify(tts.status));
  if (!tts.provider) throw new Error('No TTS provider: ' + tts.status.detail);
  await tts.provider.speak('Every night at exactly eleven PM, the lighthouse keeper climbed the stairs.', wav);
  console.log('TTS wrote', wav);

  const stt = await getSttProvider();
  console.log('STT status:', JSON.stringify(stt.status));
  if (!stt.provider) throw new Error('No STT provider: ' + stt.status.detail);

  const t0 = Date.now();
  const transcript = await stt.provider.transcribe(wav);
  console.log(`transcribed in ${Date.now() - t0}ms via ${transcript.provider}`);
  console.log('text:', transcript.text);
  console.log('words:', transcript.words.length, JSON.stringify(transcript.words.slice(0, 6)));
  console.log('cues:', JSON.stringify(wordsToCues(transcript.words).slice(0, 3), null, 1));
  console.log('segments:', JSON.stringify(wordsToSegments(transcript.words).map((s) => ({text: s.text, startMs: s.startMs, endMs: s.endMs})), null, 1));
};

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});