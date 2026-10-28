/**
 * ParallaxStack — 2.5D layered renderer.
 *
 * LayerSpec presets are drawn procedurally (SVG/gradients, deterministic
 * pseudo-random) so no third-party artwork is required; each layer moves by
 * `depth` under the scene's camera transform, producing parallax, push and
 * horizontal drift exactly as specified in the plan.
 */
import React, {useMemo} from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import type {LayerSpec, Scene} from '../../engine/types';
import type {StyleTokens} from '../../styles/tokens';
import {rand01} from './anim';
import {SceneText} from './SceneText';

export interface ParallaxStackProps {
  scene: Scene;
  tokens: StyleTokens;
  progress: number; // 0..1 over the scene
}

const layerAmp = (depth: number) => 0.04 + depth * 0.16; // scale push per depth
const panAmp = (depth: number) => 60 + depth * 220; // px drift per depth

const Sky: React.FC<{layer: LayerSpec; tokens: StyleTokens}> = ({layer, tokens}) => {
  const tint = layer.color ?? tokens.colors.bg;
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${tint} 0%, ${tokens.colors.bgDeep} 78%)`,
      }}
    />
  );
};

const Stars: React.FC<{layer: LayerSpec; tokens: StyleTokens}> = ({layer, tokens}) => {
  const stars = useMemo(() => {
    return new Array(140).fill(0).map((_, i) => ({
      x: rand01(i * 3 + 1) * 100,
      y: rand01(i * 3 + 2) * 62,
      r: 0.6 + rand01(i * 3 + 3) * 1.7,
      o: 0.35 + rand01(i * 7 + 5) * 0.65,
      tw: rand01(i * 11 + 9) * Math.PI * 2,
    }));
  }, []);
  const base = layer.color ?? '#dfe8ff';
  return (
    <AbsoluteFill>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r * 0.12} fill={base} opacity={s.o} />
        ))}
      </svg>
    </AbsoluteFill>
  );
};

const Moon: React.FC<{layer: LayerSpec}> = ({layer}) => {
  const x = layer.offset?.x ?? 72;
  const y = layer.offset?.y ?? 22;
  const color = layer.color ?? '#f4ecd8';
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${y}%`,
          width: '13vmin',
          height: '13vmin',
          marginLeft: '-6.5vmin',
          marginTop: '-6.5vmin',
          borderRadius: '50%',
          background: `radial-gradient(circle at 38% 36%, ${color}, ${color}cc 60%, ${color}88)`,
          boxShadow: `0 0 9vmin 2vmin ${color}44, 0 0 26vmin 8vmin ${color}22`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Layered silhouette shapes: mountains / city / field share the generator. */
const Silhouette: React.FC<{layer: LayerSpec; kind: string; tokens: StyleTokens}> = ({layer, kind, tokens}) => {
  const color = layer.color ?? tokens.colors.bgDeep;
  const seed = Math.round((layer.offset?.x ?? 0) * 37 + layer.depth * 101) + (kind === 'city' ? 777 : 0);
  const path = useMemo(() => {
    const pts: string[] = [];
    if (kind === 'city') {
      // blocky skyline
      let x = -4;
      const segs: string[] = [];
      while (x < 106) {
        const w = 3 + rand01(seed + x) * 7;
        const h = 14 + rand01(seed + x * 2) * 34;
        segs.push(`M${x} 100 L${x} ${100 - h} L${x + w} ${100 - h} L${x + w} 100 Z`);
        x += w + 0.6;
      }
      return segs.join(' ');
    }
    // rolling ridge
    let d = `M-5 100 `;
    for (let i = 0; i <= 9; i++) {
      const px = -5 + i * 12.5;
      const peak = 100 - (22 + rand01(seed + i) * 38);
      d += `L${px + 6.25} ${peak} `;
      d += `L${px + 12.5} ${100 - (14 + rand01(seed + i * 5) * 26)} `;
    }
    d += 'L106 100 Z';
    return pts.join(' ') || d;
  }, [kind, seed]);
  return (
    <AbsoluteFill>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d={path} fill={color} />
      </svg>
    </AbsoluteFill>
  );
};

const Sea: React.FC<{layer: LayerSpec; tokens: StyleTokens; progress: number}> = ({layer, tokens, progress}) => {
  const color = layer.color ?? '#0d2036';
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '58%',
          bottom: 0,
          background: `linear-gradient(180deg, ${color} 0%, ${tokens.colors.bgDeep} 100%)`,
        }}
      />
      {new Array(7).fill(0).map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${-20 + i * 14 + Math.sin(progress * Math.PI * 2 + i) * 3}%`,
            top: `${62 + i * 5.2}%`,
            width: `${34 + i * 6}%`,
            height: '1.6%',
            borderRadius: '999px',
            background: `rgba(255,255,255,${0.05 + i * 0.012})`,
            filter: 'blur(2px)',
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

const Fog: React.FC<{layer: LayerSpec; progress: number}> = ({layer, progress}) => {
  const color = layer.color ?? 'rgba(200,214,235,0.16)';
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      {new Array(4).fill(0).map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${-30 + i * 26 + progress * (i % 2 === 0 ? 16 : -12)}%`,
            top: `${54 + i * 9}%`,
            width: '70%',
            height: '9%',
            borderRadius: '50%',
            background: color,
            filter: 'blur(26px)',
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

const Road: React.FC<{layer: LayerSpec; progress: number}> = ({layer, progress}) => {
  const color = layer.color ?? '#171c29';
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M34 100 L45 63 L55 63 L68 100 Z" fill={color} />
        <path d="M49 100 L49.2 88 L50.8 88 L51 100 Z M49.35 83 L49.5 76 L50.5 76 L50.65 83 Z M49.55 72 L49.65 68 L50.35 68 L50.45 72 Z" fill="#d9c58b" opacity="0.72" />
      </svg>
      <div style={{position: 'absolute', left: `${39 + Math.sin(progress * Math.PI * 2) * 1.3}%`, top: '72%', width: '5%', height: '0.7%', background: '#f0d28c', filter: 'blur(7px)', opacity: 0.5}} />
    </AbsoluteFill>
  );
};

const Field: React.FC<{layer: LayerSpec; tokens: StyleTokens}> = ({layer, tokens}) => {
  const color = layer.color ?? '#0a1410';
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '34%',
          background: `linear-gradient(180deg, ${color}, ${tokens.colors.bgDeep})`,
        }}
      />
    </AbsoluteFill>
  );
};

const Room: React.FC<{layer: LayerSpec; tokens: StyleTokens}> = ({layer, tokens}) => {
  const wall = layer.color ?? '#131a2a';
  return (
    <AbsoluteFill style={{background: `linear-gradient(180deg, ${wall}, ${tokens.colors.bgDeep})`}}>
      <div
        style={{
          position: 'absolute',
          left: '58%',
          top: '18%',
          width: '22%',
          height: '44%',
          background: `linear-gradient(180deg, ${tokens.colors.accent2}33, ${tokens.colors.accent}1a)`,
          border: `0.5vmin solid ${tokens.colors.bgDeep}`,
          boxShadow: `0 0 10vmin ${tokens.colors.accent}22`,
        }}
      />
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: '26%', background: '#0a0e18'}} />
    </AbsoluteFill>
  );
};

const LayerView: React.FC<{layer: LayerSpec; tokens: StyleTokens; progress: number}> = ({layer, tokens, progress}) => {
  switch (layer.asset) {
    case 'sky':
      return <Sky layer={layer} tokens={tokens} />;
    case 'stars':
      return <Stars layer={layer} tokens={tokens} />;
    case 'moon':
      return <Moon layer={layer} />;
    case 'mountains':
      return <Silhouette layer={layer} kind="mountains" tokens={tokens} />;
    case 'city':
      return <Silhouette layer={layer} kind="city" tokens={tokens} />;
    case 'sea':
      return <Sea layer={layer} tokens={tokens} progress={progress} />;
    case 'fog':
      return <Fog layer={layer} progress={progress} />;
    case 'field':
      return <Field layer={layer} tokens={tokens} />;
    case 'road':
      return <Road layer={layer} progress={progress} />;
    case 'room':
      return <Room layer={layer} tokens={tokens} />;
    default:
      return (
        <AbsoluteFill
          style={{background: `linear-gradient(180deg, ${layer.color ?? tokens.colors.bg}, ${tokens.colors.bgDeep})`}}
        />
      );
  }
};

export const ParallaxStack: React.FC<ParallaxStackProps> = ({scene, tokens, progress}) => {
  const {width, height} = useVideoConfig();
  const cam = scene.camera ?? 'static';
  const layers = scene.layers ?? [];

  return (
    <AbsoluteFill style={{backgroundColor: tokens.colors.bgDeep, overflow: 'hidden'}}>
      {layers
        .slice()
        .sort((a, b) => a.depth - b.depth)
        .map((layer, i) => {
          const depth = layer.depth;
          const push = 1 + layerAmp(depth) * progress; // near layers grow faster
          let dx = 0;
          let dy = 0;
          if (cam === 'pan-left') dx = panAmp(depth) * (1 - progress * 2) * -1;
          else if (cam === 'pan-right') dx = panAmp(depth) * (progress * 2 - 1);
          else if (cam === 'pan-up') dy = panAmp(depth) * (progress * 2 - 1);
          else if (cam === 'pan-down') dy = panAmp(depth) * (1 - progress * 2) * -1;
          else {
            // gentle ambient drift so static scenes still breathe
            dx = Math.sin(progress * Math.PI) * depth * 18;
          }
          const baseScale = cam === 'push-in' ? push : 1 + layerAmp(depth) * 0.35;
          const scale = cam === 'pull-out' ? 1 + layerAmp(depth) * (1 - progress) : baseScale;
          return (
            <AbsoluteFill
              key={`${layer.asset}-${i}`}
              style={{
                transform: `translate3d(${(dx / width) * 100}%, ${(dy / height) * 100}%, 0) scale(${scale.toFixed(4)})`,
                transformOrigin: 'center center',
                willChange: 'transform',
              }}
            >
              <LayerView layer={layer} tokens={tokens} progress={progress} />
            </AbsoluteFill>
          );
        })}
      {scene.text && scene.text.length > 0 ? <SceneText scene={scene} tokens={tokens} /> : null}
    </AbsoluteFill>
  );
};