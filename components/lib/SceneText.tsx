/** SceneText — positioned text layer shared by every scene type. */
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import type {Scene} from '../../engine/types';
import type {StyleTokens} from '../../styles/tokens';
import {clamp01, easeOut} from './anim';

export const SceneText: React.FC<{scene: Scene; tokens: StyleTokens}> = ({scene, tokens}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  if (!scene.text || scene.text.length === 0) return null;
  return (
    <>
      {scene.text.map((spec, i) => {
        const start = Math.round((i * 0.18 + 0.1) * fps);
        const p = easeOut(clamp01((frame - start) / Math.round(0.5 * fps)));
        const y = spec.y ?? 0.5;
        const x = spec.x ?? 0.5;
        const size = (spec.size ?? 64) * (height / 1080);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              transform: `translate(-50%, -50%) translateY(${((1 - p) * 24).toFixed(2)}px)`,
              opacity: p,
              fontFamily: spec.role === 'title' ? tokens.fonts.title : tokens.fonts.body,
              fontWeight: spec.role === 'title' ? 800 : 600,
              fontSize: size,
              color: spec.color ?? tokens.colors.fg,
              textAlign: 'center',
              maxWidth: '86%',
              lineHeight: 1.15,
              textShadow: '0 4px 24px rgba(0,0,0,0.55)',
              letterSpacing: spec.role === 'title' ? '-0.01em' : '0.01em',
              whiteSpace: 'pre-wrap',
            }}
          >
            {spec.text}
          </div>
        );
      })}
    </>
  );
};