/**
 * TwoDScene — reusable 2D animation engine.
 *
 * Composition: procedural illustrated environment (ParallaxStack) → optional
 * simple character with idle/blink animation → environmental effects →
 * typography. Everything is drawn from plan data (no external artwork), so
 * scenes are original and consistent with the style tokens.
 *
 * scene.data knobs:
 *   character: {x, y, scale, tone: 'silhouette'|'flat', coat, skin}
 *   effects:   'fireflies' | 'rain' | 'snow' | 'none'
 *   beam:      {x, y} — origin of a rotating light cone (lighthouse beam)
 */
import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneComponentProps} from './ClipScene';
import {ParallaxStack} from '../lib/ParallaxStack';
import {SceneText} from '../lib/SceneText';
import {clamp01, easeInOut, rand01} from '../lib/anim';

interface CharacterSpec {
  x?: number; // 0..1 anchor
  y?: number; // 0..1 baseline
  scale?: number; // multiplier
  tone?: 'silhouette' | 'flat';
  coat?: string;
  skin?: string;
  action?: 'idle' | 'walk' | 'talk';
  identity?: string;
  descriptors?: string[];
}

const Character: React.FC<{spec: CharacterSpec; tokens: SceneComponentProps['tokens']; frame: number; fps: number; height: number}> = ({
  spec,
  tokens,
  frame,
  fps,
  height,
}) => {
  const s = spec.scale ?? 1;
  const h = height * 0.42 * s;
  const w = h * 0.42;
  const silhouette = (spec.tone ?? 'silhouette') === 'silhouette';
  const coat = spec.coat ?? tokens.colors.bgDeep;
  const skin = spec.skin ?? '#e8b893';

  const breathe = Math.sin((frame / fps) * Math.PI * 1.1) * h * 0.008;
  const sway = Math.sin((frame / fps) * Math.PI * 0.55) * 1.4;
  const blinkCycle = ((frame / fps) * 0.55 + rand01(3)) % 4.2;
  const blinking = blinkCycle > 4.0;
  const action = spec.action ?? 'idle';
  const stride = action === 'walk' ? Math.sin((frame / fps) * Math.PI * 3.2) : 0;
  const travel = action === 'walk' ? Math.min(26, (frame / fps) * 6) : 0;
  const descriptors = spec.descriptors ?? [];
  const wearsTurban = descriptors.includes('turban') || descriptors.includes('punjabi');
  const hasBeard = descriptors.includes('beard') || descriptors.includes('moustache');
  const armSwing = action === 'walk' ? Math.sin((frame / fps) * Math.PI * 3.2 + Math.PI) : Math.sin((frame / fps) * 1.1) * 0.06;
  const mouthOpen = action === 'talk' ? 2 + Math.abs(Math.sin((frame / fps) * Math.PI * 4.1)) * 7 : 2;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${Math.min(88, (spec.x ?? 0.5) * 100 + travel)}%`,
        bottom: `${(spec.y ?? 0.18) * 100}%`,
        transform: `translateX(-50%) translateY(${breathe.toFixed(2)}px) rotate(${sway.toFixed(2)}deg)`,
        transformOrigin: 'bottom center',
        width: w,
        height: h,
      }}
    >
      <svg width={w} height={h} viewBox="0 0 100 240" style={{overflow: 'visible'}}>
        {/* articulated legs: alternating stride is frame-derived for repeatable renders */}
        <path d={`M42 151 Q${42 + stride * 10} 186 ${42 + stride * 15} 232`} stroke={silhouette ? '#05070c' : '#1d2740'} strokeWidth="11" fill="none" strokeLinecap="round" />
        <path d={`M57 151 Q${57 - stride * 10} 186 ${57 - stride * 15} 232`} stroke={silhouette ? '#05070c' : '#1d2740'} strokeWidth="11" fill="none" strokeLinecap="round" />
        {/* coat / body */}
        <path
          d="M28 78 Q50 66 72 78 L78 158 Q50 168 22 158 Z"
          fill={silhouette ? '#070a12' : coat}
        />
        {/* articulated arms counter-swing against the walk cycle */}
        <path d={`M30 84 Q${24 + armSwing * 15} 112 ${24 + armSwing * 22} 140`} stroke={silhouette ? '#070a12' : coat} strokeWidth="13" fill="none" strokeLinecap="round" />
        <path d={`M70 84 Q${76 - armSwing * 15} 112 ${76 - armSwing * 22} 140`} stroke={silhouette ? '#070a12' : coat} strokeWidth="13" fill="none" strokeLinecap="round" />
        {/* head */}
        <circle cx="50" cy="52" r="26" fill={silhouette ? '#0a0e18' : skin} />
        {/* Hair or a persistent turban silhouette for identity-consistent wardrobe. */}
        {wearsTurban ? (
          <>
            <path d="M24 47 Q22 22 50 18 Q78 22 76 47 L70 42 Q70 27 50 25 Q30 27 30 42 Z" fill={silhouette ? '#05070c' : '#d7b74d'} />
            <path d="M30 35 Q50 31 70 35" stroke={silhouette ? '#05070c' : '#b79132'} strokeWidth="4" fill="none" />
          </>
        ) : <path d="M24 48 Q26 22 50 24 Q74 22 76 48 Q62 34 50 36 Q38 34 24 48" fill={silhouette ? '#05070c' : '#2c2118'} />}
        {hasBeard && !silhouette ? <path d="M29 60 Q50 72 71 60 Q68 85 50 87 Q32 85 29 60" fill="#241c1b" /> : null}
        {/* mouth: small speaking cycle when this beat has narration */}
        {!silhouette ? <ellipse cx="51" cy="68" rx="5" ry={mouthOpen} fill="#542d2c" opacity="0.85" /> : null}
        {/* eyes (blink) */}
        {!silhouette ? (
          blinking ? (
            <>
              <rect x="39" y="52" width="8" height="2" rx="1" fill="#1a1a1a" />
              <rect x="55" y="52" width="8" height="2" rx="1" fill="#1a1a1a" />
            </>
          ) : (
            <>
              <circle cx="43" cy="53" r="3.4" fill="#1a1a1a" />
              <circle cx="59" cy="53" r="3.4" fill="#1a1a1a" />
            </>
          )
        ) : null}
      </svg>
    </div>
  );
};

const Beam: React.FC<{origin: {x: number; y: number}; frame: number; fps: number; tokens: SceneComponentProps['tokens']}> = ({
  origin,
  frame,
  fps,
  tokens,
}) => {
  const angle = ((frame / fps) * 42) % 360; // slow rotation, ~8.5s/rev
  return (
    <div
      style={{
        position: 'absolute',
        left: `${origin.x * 100}%`,
        top: `${origin.y * 100}%`,
        width: 0,
        height: 0,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '160vmax',
          height: '7vmax',
          transformOrigin: '0% 50%',
          transform: `rotate(${angle.toFixed(2)}deg)`,
          background: `linear-gradient(90deg, ${tokens.colors.highlight}55 0%, ${tokens.colors.highlight}00 70%)`,
          filter: 'blur(6px)',
          borderRadius: '50%',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '-2vmin',
          top: '-2vmin',
          width: '4vmin',
          height: '4vmin',
          borderRadius: '50%',
          background: tokens.colors.highlight,
          boxShadow: `0 0 6vmin 2vmin ${tokens.colors.highlight}66`,
        }}
      />
    </div>
  );
};

const Effects: React.FC<{kind: string; frame: number; fps: number; tokens: SceneComponentProps['tokens']}> = ({
  kind,
  frame,
  fps,
  tokens,
}) => {
  const items = useMemo(() => {
    const n = kind === 'rain' ? 90 : kind === 'snow' ? 60 : 34;
    return new Array(n).fill(0).map((_, i) => ({
      x: rand01(i * 7 + 1) * 100,
      y0: rand01(i * 7 + 2) * 100,
      v: 0.5 + rand01(i * 7 + 3) * 1.4,
      r: rand01(i * 7 + 4),
      ph: rand01(i * 7 + 5) * Math.PI * 2,
    }));
  }, [kind]);
  const t = frame / fps;

  if (kind === 'fireflies') {
    return (
      <AbsoluteFill style={{pointerEvents: 'none'}}>
        {items.map((p, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${p.x + Math.sin(t * p.v + p.ph) * 3}%`,
              top: `${(p.y0 * 0.7 + 15) + Math.cos(t * p.v * 0.8 + p.ph) * 4}%`,
              width: 6 + p.r * 8,
              height: 6 + p.r * 8,
              borderRadius: '50%',
              background: tokens.colors.highlight,
              opacity: 0.25 + 0.75 * Math.abs(Math.sin(t * 1.6 + p.ph)),
              boxShadow: `0 0 12px 4px ${tokens.colors.highlight}55`,
            }}
          />
        ))}
      </AbsoluteFill>
    );
  }
  if (kind === 'rain') {
    return (
      <AbsoluteFill style={{pointerEvents: 'none', overflow: 'hidden'}}>
        {items.map((p, i) => {
          const y = (p.y0 + t * p.v * 46) % 120 - 10;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${p.x}%`,
                top: `${y}%`,
                width: 1.5,
                height: 26,
                background: 'linear-gradient(180deg, transparent, rgba(200,220,255,0.55))',
                transform: 'rotate(6deg)',
              }}
            />
          );
        })}
      </AbsoluteFill>
    );
  }
  if (kind === 'snow') {
    return (
      <AbsoluteFill style={{pointerEvents: 'none', overflow: 'hidden'}}>
        {items.map((p, i) => {
          const y = (p.y0 + t * p.v * 9) % 115 - 8;
          const x = p.x + Math.sin(t * p.v + p.ph) * 4;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${x}%`,
                top: `${y}%`,
                width: 3 + p.r * 5,
                height: 3 + p.r * 5,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.85)',
                opacity: 0.5 + p.r * 0.5,
              }}
            />
          );
        })}
      </AbsoluteFill>
    );
  }
  return null;
};

export const TwoDScene: React.FC<SceneComponentProps> = ({scene, tokens}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const hasLayers = Boolean(scene.layers && scene.layers.length > 0);
  const dur = Math.max(1, Math.round(scene.duration * fps));
  const t = easeInOut(clamp01(frame / dur));

  const character = scene.data?.character as CharacterSpec | undefined;
  const beam = scene.data?.beam as {x: number; y: number} | undefined;
  const effect = (scene.data?.effects as string | undefined) ?? 'none';

  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: tokens.colors.bgDeep}}>
      {/* environment: parallax layers when present, else gradient */}
      {hasLayers ? (
        <ParallaxStack scene={scene} tokens={tokens} progress={t} />
      ) : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at 30% 25%, ${tokens.colors.bg} 0%, ${tokens.colors.bgDeep} 75%)`,
          }}
        />
      )}

      {beam ? <Beam origin={beam} frame={frame} fps={fps} tokens={tokens} /> : null}
      {character ? <Character key={character.identity ?? 'character'} spec={character} tokens={tokens} frame={frame} fps={fps} height={height} /> : null}
      {effect !== 'none' ? <Effects kind={effect} frame={frame} fps={fps} tokens={tokens} /> : null}

      {/* ParallaxStack already renders scene.text when layers are present */}
      {!hasLayers && scene.text && scene.text.length > 0 ? <SceneText scene={scene} tokens={tokens} /> : null}
    </AbsoluteFill>
  );
};