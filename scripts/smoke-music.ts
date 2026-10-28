/** Smoke test: verify offline music bed + SFX synthesis produce real audio. */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {synthesizeBed, synthesizeSfx, synthesizeSfxSet} from '../providers/music/index';
import {probe, audioPeakDb} from '../engine/media/ffmpeg';

const out = path.resolve('outputs/smoke-music');

const main = async () => {
  await fs.mkdir(out, {recursive: true});

  for (const mood of ['calm', 'upbeat', 'tense'] as const) {
    const bed = path.join(out, `bed-${mood}.wav`);
    const t0 = Date.now();
    await synthesizeBed({durationSec: 12, mood, output: bed});
    const p = await probe(bed);
    const peak = await audioPeakDb(bed);
    console.log(
      `bed ${mood.padEnd(7)} dur=${p.duration.toFixed(2)}s ch=${p.hasAudio ? 'audio' : 'NONE'} peak=${peak.maxDb.toFixed(1)}dB (${Date.now() - t0}ms)`,
    );
  }

  const sfx = await synthesizeSfxSet(out);
  for (const [kind, file] of Object.entries(sfx)) {
    const p = await probe(file);
    const peak = await audioPeakDb(file);
    console.log(`sfx ${kind.padEnd(7)} dur=${p.duration.toFixed(2)}s peak=${peak.maxDb.toFixed(1)}dB`);
  }

  // single-effect path
  const one = await synthesizeSfx('riser', path.join(out, 'riser-single.wav'));
  const op = await probe(one);
  console.log(`single riser dur=${op.duration.toFixed(2)}s`);
};

main().then(
  () => console.log('SMOKE MUSIC OK'),
  (e) => {
    console.error('SMOKE MUSIC FAILED:', e?.message ?? e);
    if (e?.stderr) console.error(String(e.stderr).split('\n').slice(-8).join('\n'));
    process.exit(1);
  },
);
