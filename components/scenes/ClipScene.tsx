import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Scene, VideoPlan} from '../../engine/types';
import type {StyleTokens} from '../../styles/tokens';
import {cameraTransform, clamp01, easeInOut, easeOut} from '../lib/anim';
import {ParallaxStack} from '../lib/ParallaxStack';
import {SceneText} from '../lib/SceneText';

export interface SceneComponentProps {
  scene: Scene;
  plan: VideoPlan;
  tokens: StyleTokens;
}

/**
 * ClipScene — real footage on the base track (talking head, B-roll video).
 * Audio is intentionally not rendered here: the master audio mix is produced
 * by FFmpeg (cut-aligned) and muxed after render, so cuts and ducking stay
 * frame-exact.
 */
export const ClipScene: React.FC<SceneComponentProps> = ({scene, tokens}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const durFrames = Math.max(1, Math.round(scene.duration * fps));
  const t = clamp01(frame / durFrames);
  const cam = cameraTransform(scene.camera, tokens.motion.ease(t), tokens.motion.intensity);

  // optional punch-in specified per scene (talking-head editing)
  const punchIn = typeof scene.data?.punchIn === 'number' ? (scene.data.punchIn as number) : 1;
  const punchT = typeof scene.data?.punchRamp === 'number' ? (scene.data.punchRamp as number) : 0;
  const punchScale = 1 + (punchIn - 1) * (punchT > 0 ? easeOut(clamp01(t / punchT)) : 1);

  const trimBeforeSec = typeof scene.data?.trimBeforeSec === 'number' ? (scene.data.trimBeforeSec as number) : 0;
  const playbackRate = typeof scene.data?.playbackRate === 'number' ? (scene.data.playbackRate as number) : 1;

  if (!scene.src) {
    return (
      <AbsoluteFill style={{backgroundColor: tokens.colors.bg}}>
        <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
          <div style={{color: tokens.colors.muted, fontFamily: tokens.fonts.body, fontSize: height * 0.03}}>
            Missing media for scene “{scene.id}”
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{backgroundColor: tokens.colors.bgDeep, overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          transform: `scale(${(cam.scale * punchScale).toFixed(4)}) translate(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px)`,
          transformOrigin: 'center center',
        }}
      >
        {scene.data?.reframeMode === 'blur-fill-contain' ? (
          <>
            {/* Preserve the full original frame; blurred cover-fill avoids black bars without cropping the subject. */}
            <OffthreadVideo
              src={staticFile(scene.src)}
              muted
              trimBefore={Math.round(trimBeforeSec * fps)}
              playbackRate={playbackRate}
              style={{position: 'absolute', inset: '-8%', width: '116%', height: '116%', objectFit: 'cover', filter: 'blur(34px) brightness(0.42)', transform: 'scale(1.08)'}}
            />
            <OffthreadVideo
              src={staticFile(scene.src)}
              muted
              trimBefore={Math.round(trimBeforeSec * fps)}
              playbackRate={playbackRate}
              style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 8px 28px rgba(0,0,0,0.35))'}}
            />
          </>
        ) : (
          <OffthreadVideo
            src={staticFile(scene.src)}
            muted
            trimBefore={Math.round(trimBeforeSec * fps)}
            playbackRate={playbackRate}
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
          />
        )}
      </AbsoluteFill>
      {/* subtle depth vignette on footage */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${0.25 * tokens.grade.vignette + 0.05}) 100%)`,
          pointerEvents: 'none',
        }}
      />
      <SceneText scene={scene} tokens={tokens} />
    </AbsoluteFill>
  );
};

/** Ken-Burns image scene with camera move + parallax-friendly wrapper. */
export const ImageScene: React.FC<SceneComponentProps> = ({scene, tokens}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const durFrames = Math.max(1, Math.round(scene.duration * fps));
  const t = easeInOut(clamp01(frame / durFrames));
  const cam = cameraTransform(scene.camera, t, tokens.motion.intensity);
  const hasLayers = Boolean(scene.layers && scene.layers.length > 0);

  if (hasLayers) {
    // Layered 2.5D parallax plates rendered from LayerSpec presets
    return <ParallaxStack scene={scene} tokens={tokens} progress={t} />;
  }

  return (
    <AbsoluteFill style={{backgroundColor: tokens.colors.bgDeep, overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          transform: `scale(${cam.scale.toFixed(4)}) translate(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px)`,
        }}
      >
        {scene.src ? (
          scene.data?.reframeMode === 'blur-fill-contain' ? (
            <>
              <Img src={staticFile(scene.src)} style={{position:'absolute',inset:'-8%',width:'116%',height:'116%',objectFit:'cover',filter:'blur(34px) brightness(0.42)',transform:'scale(1.08)'}} />
              <Img src={staticFile(scene.src)} style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain',display:'block'}} />
            </>
          ) : (
            <Img src={staticFile(scene.src)} style={{width: '100%', height: '100%', objectFit: 'cover', display: 'block'}} />
          )
        ) : (
          <AbsoluteFill style={{background: `linear-gradient(160deg, ${tokens.colors.bg}, ${tokens.colors.bgDeep})`}} />
        )}
      </AbsoluteFill>
      <SceneText scene={scene} tokens={tokens} />
    </AbsoluteFill>
  );
};