import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneComponentProps} from './ClipScene';
import type {Scene} from '../../engine/types';
import type {StyleTokens} from '../../styles/tokens';
import {clamp01, easeInOut, rand01} from '../lib/anim';
import {SceneText} from '../lib/SceneText';

/**
 * AbstractScene — procedural visuals for sections with no concrete asset:
 * drifting gradient fields + deterministic particle field + optional data bars.
 * Chosen by the planner when narration has no literal visual (concepts,
 * transitions, audio-only gaps).
 *
 * scene.data knobs:
 *   variant: 'drift' | 'grid' | 'pulse' | 'bars'
 *   bars: number[] — values 0..1 for the 'bars' variant
 */
export const AbstractScene: React.FC<SceneComponentProps> = ({scene, tokens}) => {
  const frame = useCurrentFrame();
  const {fps, height, width} = useVideoConfig();
  const dur = Math.max(1, Math.round(scene.duration * fps));
  const t = clamp01(frame / dur);
  const variant = (scene.data?.variant as string) ?? 'drift';

  const particles = useMemo(
    () =>
      new Array(46).fill(0).map((_, i) => ({
        x: rand01(i * 5 + 1) * 100,
        y: rand01(i * 5 + 2) * 100,
        r: 1.2 + rand01(i * 5 + 3) * 4.5,
        speed: 0.3 + rand01(i * 5 + 4) * 1.4,
        phase: rand01(i * 5 + 5) * Math.PI * 2,
        hue: rand01(i * 9 + 7),
      })),
    [],
  );

  const breathe = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * (0.6 + tokens.motion.intensity));

  return (
    <AbsoluteFill style={{background: tokens.colors.bgDeep, overflow: 'hidden'}}>
      {/* moving gradient field */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 55% at ${25 + 15 * Math.sin(t * Math.PI * 2)}% ${
            30 + 10 * Math.cos(t * Math.PI * 2)
          }%, ${tokens.colors.accent2}${variant === 'pulse' ? '55' : '33'} 0%, transparent 60%),
             radial-gradient(ellipse 60% 50% at ${75 - 12 * Math.sin(t * Math.PI * 2 + 1)}% ${
            70 + 8 * Math.sin(t * Math.PI * 2 * 0.7)
          }%, ${tokens.colors.accent}${variant === 'pulse' ? '44' : '22'} 0%, transparent 65%),
             linear-gradient(160deg, ${tokens.colors.bg}, ${tokens.colors.bgDeep})`,
        }}
      />

      {variant === 'grid' ? <GridField t={t} tokens={tokens} /> : null}

      {/* deterministic particle drift */}
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{position: 'absolute'}}>
        {particles.map((p, i) => {
          const yy = (p.y - t * p.speed * 12 + 200) % 100;
          const xx = p.x + Math.sin(t * Math.PI * 2 * p.speed + p.phase) * 3;
          const op = 0.12 + 0.5 * (0.5 + 0.5 * Math.sin(t * Math.PI * 4 + p.phase));
          return (
            <circle
              key={i}
              cx={xx}
              cy={yy}
              r={(p.r / width) * 100}
              fill={p.hue > 0.6 ? tokens.colors.accent : tokens.colors.fg}
              opacity={op}
            />
          );
        })}
      </svg>

      {variant === 'bars' ? <DataBars scene={scene} tokens={tokens} t={t} /> : null}

      {/* SceneText sits on top */}
      {scene.text && scene.text.length > 0 ? <SceneTextHost scene={scene} tokens={tokens} /> : null}

      {/* breathing light center */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, ${tokens.colors.accent}${Math.round(8 + 10 * breathe)
            .toString(16)
            .padStart(2, '0')} 0%, transparent 45%)`,
        }}
      />
    </AbsoluteFill>
  );
};

const GridField: React.FC<{t: number; tokens: SceneComponentProps['tokens']}> = ({t, tokens}) => (
  <AbsoluteFill style={{opacity: 0.35, perspective: 600}}>
    <div
      style={{
        position: 'absolute',
        inset: '-40%',
        backgroundImage: `linear-gradient(${tokens.colors.accent2}33 1px, transparent 1px),
                         linear-gradient(90deg, ${tokens.colors.accent2}33 1px, transparent 1px)`,
        backgroundSize: '6% 6%',
        transform: `rotateX(58deg) translateY(${(t * 18 - 9).toFixed(1)}%)`,
        transformOrigin: 'center 70%',
      }}
    />
  </AbsoluteFill>
);

const DataBars: React.FC<{scene: SceneComponentProps['scene']; tokens: SceneComponentProps['tokens']; t: number}> = ({
  scene,
  tokens,
  t,
}) => {
  const values = (scene.data?.bars as number[] | undefined) ?? [0.4, 0.65, 0.5, 0.85, 0.7];
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      <div style={{display: 'flex', gap: '2.4%', alignItems: 'flex-end', height: '38%', width: '64%'}}>
        {values.map((v, i) => {
          const p = easeInOut(clamp01((t - i * 0.06) * 3.2));
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${Math.max(4, v * 100 * p)}%`,
                borderRadius: 8,
                background: `linear-gradient(180deg, ${tokens.colors.accent}, ${tokens.colors.accent2})`,
                boxShadow: `0 0 24px ${tokens.colors.accent}44`,
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const SceneTextHost: React.FC<{scene: Scene; tokens: StyleTokens}> = ({scene, tokens}) => (
  <SceneText scene={scene} tokens={tokens} />
);