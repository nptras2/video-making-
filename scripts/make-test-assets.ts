// Builds the fixture set required by the project's three end-to-end tests.
// These are synthetic but real media files: the talking-head test is a video
// track with genuine synthesized narration and deliberate pauses so silence
// detection has real work to do; the 2D test is a narration-only audio file;
// the 3D test is a short theme script.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {ffmpeg, probe} from '../engine/media/ffmpeg';
import {getVoiceProvider} from '../providers/voice/index';

const ROOT = path.resolve('outputs/test-assets');

const silence = async (seconds: number, out: string) => {
  await ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`, '-t', String(seconds), '-c:a', 'pcm_s16le', out]);
  return out;
};

const normalise = async (input: string, out: string) => {
  await ffmpeg(['-i', input, '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  return out;
};

const concatWavs = async (files: string[], out: string) => {
  const listFile = out + '.txt';
  await fs.writeFile(listFile, files.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out]);
  await fs.rm(listFile, {force: true});
  return out;
};

const main = async () => {
  await fs.mkdir(ROOT, {recursive: true});
  const voice = await getVoiceProvider();
  if (!voice.provider) throw new Error(`no voice provider: ${voice.status.detail}`);
  console.log(`Voice: ${voice.status.name}`);

  /* ---------------- TEST 1: talking head (video + narration) ---------------- */
  const lines = [
    'Most talking head videos fail for one reason. They keep every pause.',
    'Your viewer does not need to hear you think. They need the point.',
    'So here is the editing rule I use on every single project.',
    'Cut the dead air down to a short breath, never to silence.',
    'The camera stays honest, the microphone stays close, and the pacing carries the story.',
  ];

  const pieces: string[] = [await silence(0.8, path.join(ROOT, 'sil-08.wav'))];
  for (let i = 0; i < lines.length; i++) {
    const raw = path.join(ROOT, `t1-speech-${i}.wav`);
    await voice.provider.speak(lines[i], raw, {rate: 1});
    pieces.push(await normalise(raw, path.join(ROOT, `t1-norm-${i}.wav`)));
    pieces.push(await silence(i % 2 === 0 ? 1.4 : 0.9, path.join(ROOT, `t1-gap-${i}.wav`)));
  }
  const narration = await concatWavs(pieces, path.join(ROOT, 'talking-head-narration.wav'));
  console.log(`TEST1 narration: ${(await probe(narration)).duration.toFixed(2)}s`);

  const video = path.join(ROOT, 'talking-head.mp4');
  await ffmpeg([
    '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=30:duration=${+(await probe(narration)).duration.toFixed(3)}`,
    '-i', narration,
    '-vf', 'hue=s=0.4,eq=brightness=0.02',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-shortest',
    video,
  ]);
  console.log(`TEST1 video: ${(await probe(video)).duration.toFixed(2)}s ${(await probe(video)).width}x${(await probe(video)).height} audio=${(await probe(video)).hasAudio}`);

  const stills: Array<[string, string]> = [
    ['dead-air-editing.png', 'gradients=s=1600x900:c0=0x0b1730:c1=0xd9a441:d=1'],
    ['microphone-studio.png', 'gradients=s=1600x900:c0=0x101a33:c1=0x3f6fa8:d=1'],
    ['camera-tripod.png', 'gradients=s=1600x900:c0=0x07070c:c1=0x8a8f99:d=1'],
  ];
  for (const [name, src] of stills) {
    await ffmpeg(['-f', 'lavfi', '-i', src, '-frames:v', '1', path.join(ROOT, name)]);
  }
  console.log(`TEST1 stills: ${stills.length}`);

  /* ------------------- TEST 2: narration only → 2D story ------------------- */
  const story = [
    'Every night at eleven, the keeper climbed the hundred and thirty steps.',
    'The lighthouse had stood on that rock for a hundred years, watching the ocean.',
    'Ships came and went, but the light never slept.',
    'On the coldest night of the year, the storm arrived without warning.',
    'Waves broke over the rocks like fists against a door.',
    'The keeper kept the lamp burning until dawn.',
  ];
  const storyPieces: string[] = [];
  for (let i = 0; i < story.length; i++) {
    const raw = path.join(ROOT, `t2-speech-${i}.wav`);
    await voice.provider.speak(story[i], raw, {rate: 1});
    storyPieces.push(await normalise(raw, path.join(ROOT, `t2-norm-${i}.wav`)));
    storyPieces.push(await silence(0.35, path.join(ROOT, `t2-gap-${i}.wav`)));
  }
  const storyAudio = await concatWavs(storyPieces, path.join(ROOT, 'lighthouse-narration.wav'));
  console.log(`TEST2 narration: ${(await probe(storyAudio)).duration.toFixed(2)}s`);

  /* --------------- TEST 3: script → 3D motion graphics (no audio) --------------- */
  const script = `Aurora is an engine that turns raw footage into finished video.
It watches the timeline the way an editor does, cutting dead air before you ask.
Every asset is probed, every scene is planned, and nothing renders blind.
The result is one command instead of one afternoon.
That is the whole idea behind the product.`;
  await fs.writeFile(path.join(ROOT, 'tech-script.txt'), script, 'utf8');
  console.log(`TEST3 script: ${script.split(/\s+/).length} words`);

  console.log(`\nFixtures written to ${ROOT}`);
};

main().then(
  () => console.log('TEST ASSETS OK'),
  (e) => {
    console.error('TEST ASSETS FAILED:', e?.message ?? e);
    if (e?.stderr) console.error(String(e.stderr).split('\n').slice(-8).join('\n'));
    process.exit(1);
  },
);
