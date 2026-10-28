/** Diagnose the silence-cut vs transcript alignment on the talking-head fixture. */
import path from 'node:path';
import {detectSilence, extractAudio, probe} from '../engine/media/ffmpeg';
import {planSilenceCuts} from '../engine/editor/cuts';
import {getSttProvider} from '../providers/stt/index';

const VIDEO = path.resolve('outputs/test-assets/talking-head.mp4');

const main = async () => {
  const info = await probe(VIDEO);
  console.log(`video: ${info.duration.toFixed(3)}s audio=${info.hasAudio}`);

  const wav = await extractAudio(VIDEO, path.resolve('outputs/diag/cut-16k.wav'));
  const sil = await detectSilence(VIDEO, {noiseDb: -35, minDur: 0.5});
  console.log(`\nsilences detected (noise=-35dB, d>=0.5s): ${sil.length}`);
  for (const s of sil) console.log(`  ${s.start.toFixed(3)} → ${s.end.toFixed(3)}  (${(s.end - s.start).toFixed(3)}s)`);

  const total = sil.reduce((a, s) => a + (s.end - s.start), 0);
  console.log(`  total silence: ${total.toFixed(2)}s of ${info.duration.toFixed(2)}s`);

  const cut = await planSilenceCuts(VIDEO, {maxGap: 0.75, keepGap: 0.28, minKeep: 0.4});
  console.log(`\nkeep segments: ${cut.keep.length}, removed ${cut.removed.toFixed(2)}s`);
  for (const k of cut.keep) console.log(`  ${k.start.toFixed(3)} → ${k.end.toFixed(3)}  (${(k.end - k.start).toFixed(3)}s)`);

  const stt = await getSttProvider();
  if (!stt.provider) {
    console.log('no STT provider');
    return;
  }
  const t = await stt.provider.transcribe(wav);
  console.log(`\nwords: ${t.words.length}`);
  const inside = (ms: number) => cut.keep.some((k) => ms / 1000 >= k.start && ms / 1000 < k.end);
  const outside = t.words.filter((w) => !inside((w.startMs + w.endMs) / 2));
  console.log(`words whose midpoint is OUTSIDE every keep segment: ${outside.length}`);
  for (const w of outside.slice(0, 30)) {
    console.log(`  ${(w.startMs / 1000).toFixed(3)} → ${(w.endMs / 1000).toFixed(3)}  ${JSON.stringify(w.text)}`);
  }
  // where do the gaps in the keep list line up with words?
  console.log('\ngaps between keep segments:');
  for (let i = 0; i < cut.keep.length - 1; i++) {
    const a = cut.keep[i];
    const b = cut.keep[i + 1];
    const gapStart = a.end;
    const gapEnd = b.start;
    const affected = t.words.filter((w) => (w.startMs + w.endMs) / 2 > gapStart * 1000 && (w.startMs + w.endMs) / 2 < gapEnd * 1000);
    console.log(
      `  ${gapStart.toFixed(3)} → ${gapEnd.toFixed(3)} (${(gapEnd - gapStart).toFixed(3)}s)  drops ${affected.length} word(s): ${affected.map((w) => w.text.trim()).join(' ')}`,
    );
  }
};

main().then(
  () => console.log('\nDIAG OK'),
  (e) => {
    console.error('DIAG FAILED:', e?.message ?? e);
    if (e?.stderr) console.error(String(e.stderr).split('\n').slice(-6).join('\n'));
    process.exit(1);
  },
);
