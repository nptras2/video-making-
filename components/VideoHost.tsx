/**
 * VideoHost — the thin, plan-driven Remotion composition.
 *
 * It renders whatever the VIDEO_PLAN says by dispatching scene objects to the
 * scene registry. Nothing about a specific video is hardcoded here: new scene
 * types are registered in components/scenes/registry.ts.
 *
 * Layer order: base scenes → overlay scenes → graphic overlays → captions →
 * color grade. Audio is mixed deterministically by FFmpeg and muxed after the
 * render (renderMedia runs muted), so ducking/loudness are exact.
 */
import React, {useMemo} from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Scene, VideoPlan} from '../engine/types';
import {getStyle} from '../styles/tokens';
import {registry} from './scenes/registry';
import {CaptionLayer} from './captions/CaptionLayer';
import {GraphicOverlay} from './overlays/GraphicOverlay';
import {Grade} from './Grade';

export interface VideoHostProps {
  plan: VideoPlan;
  /** Remotion requires props to extend Record<string, unknown> */
  [key: string]: unknown;
}

interface LaidOut {
  scene: Scene;
  from: number;
  durationInFrames: number;
  fadeInFrames: number;
  fadeOutFrames: number;
}

/** Compute sequence windows, extending scenes so dissolves overlap properly. */
const layoutBaseScenes = (plan: VideoPlan, fps: number): LaidOut[] => {
  const def = plan.defaultTransition ?? {type: 'fade' as const, duration: 0.4};
  const sorted = plan.scenes
    .filter((s) => s.track !== 'overlay')
    .slice()
    .sort((a, b) => a.start - b.start);

  const out: LaidOut[] = sorted.map((scene, i) => {
    const tr = scene.transitionIn ?? def;
    const overlapFrames = i > 0 && (tr.type === 'fade' || tr.type === 'dissolve') ? Math.round(tr.duration * fps) : 0;
    const from = Math.max(0, Math.round(scene.start * fps) - overlapFrames);
    const durationInFrames = Math.round(scene.duration * fps) + (Math.round(scene.start * fps) - from);
    return {scene, from, durationInFrames, fadeInFrames: i > 0 ? overlapFrames : 0, fadeOutFrames: 0};
  });

  // extend the outgoing scene so the incoming one has content to dissolve from
  for (let i = 0; i < out.length - 1; i++) {
    const next = out[i + 1];
    if (next.fadeInFrames > 0) {
      const neededEnd = next.from + next.fadeInFrames;
      const curEnd = out[i].from + out[i].durationInFrames;
      if (neededEnd > curEnd) out[i].durationInFrames += neededEnd - curEnd;
      out[i].fadeOutFrames = next.fadeInFrames;
    }
  }
  return out;
};

/** Sequence-local opacity for scene boundaries (frame-based, no CSS animation). */
const SceneFade: React.FC<{
  totalFrames: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  children: React.ReactNode;
}> = ({totalFrames, fadeInFrames, fadeOutFrames, children}) => {
  const frame = useCurrentFrame();
  let opacity = 1;
  if (fadeInFrames > 0) opacity *= Math.min(1, Math.max(0, frame / fadeInFrames));
  if (fadeOutFrames > 0) opacity *= Math.min(1, Math.max(0, (totalFrames - frame) / fadeOutFrames));
  return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
};

export const VideoHost: React.FC<VideoHostProps> = ({plan}) => {
  const {fps, height, width} = useVideoConfig();
  const style = useMemo(() => getStyle(plan.style), [plan.style]);
  const base = useMemo(() => layoutBaseScenes(plan, fps), [plan, fps]);
  const overlayScenes = plan.scenes.filter((s) => s.track === 'overlay');

  return (
    <AbsoluteFill style={{backgroundColor: style.colors.bgDeep}}>
      {/* ---------- base scene track ---------- */}
      {base.map(({scene, from, durationInFrames, fadeInFrames, fadeOutFrames}) => {
        const Component = registry[scene.type];
        if (!Component) return null;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={durationInFrames} name={`${scene.id}:${scene.type}`}>
            <SceneFade totalFrames={durationInFrames} fadeInFrames={fadeInFrames} fadeOutFrames={fadeOutFrames}>
              <Component scene={scene} plan={plan} tokens={style} />
            </SceneFade>
          </Sequence>
        );
      })}

      {/* ---------- overlay scenes (B-roll on top of base footage) ---------- */}
      {overlayScenes.map((scene) => {
        const Component = registry[scene.type];
        if (!Component) return null;
        const dur = Math.round(scene.duration * fps);
        return (
          <Sequence
            key={scene.id}
            from={Math.round(scene.start * fps)}
            durationInFrames={dur}
            name={`${scene.id}:overlay`}
          >
            <SceneFade totalFrames={dur} fadeInFrames={Math.min(9, Math.round(dur / 3))} fadeOutFrames={Math.min(9, Math.round(dur / 3))}>
              <Component scene={scene} plan={plan} tokens={style} />
            </SceneFade>
          </Sequence>
        );
      })}

      {/* ---------- graphic overlays: lower thirds, stats, progress ---------- */}
      {(plan.overlays ?? []).map((ov) => (
        <Sequence
          key={ov.id}
          from={Math.round(ov.start * fps)}
          durationInFrames={Math.round(ov.duration * fps)}
          name={`ov:${ov.kind}`}
        >
          <GraphicOverlay overlay={ov} tokens={style} />
        </Sequence>
      ))}

      {/* ---------- captions ---------- */}
      {plan.captions && plan.captions.cues.length > 0 ? (
        <CaptionLayer
          cues={plan.captions.cues}
          style={{...plan.captions.style, ...style.caption}}
          tokens={style}
        />
      ) : null}

      {/* ---------- grade ---------- */}
      <Grade tokens={style} width={width} height={height} />
    </AbsoluteFill>
  );
};