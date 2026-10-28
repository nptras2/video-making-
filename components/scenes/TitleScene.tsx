import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneComponentProps} from './ClipScene';
import {clamp01, easeOut, easeOutBack} from '../lib/anim';

/**
 * TitleScene — animated typography card: word-by-word rise, accent rule,
 * optional subtitle. Used for hooks, chapter headings and CTAs.
 */
export const TitleScene: React.FC<SceneComponentProps> = ({scene, tokens}) => {
  const frame = useCurrentFrame();
  const {fps, height, width} = useVideoConfig();
  const title = scene.text?.find((t) => t.role === 'title') ?? scene.text?.[0];
  const subtitle = scene.text?.find((t) => t.role === 'subtitle');
  const words = (title?.text ?? scene.visual ?? '').split(/\s+/).filter(Boolean);
  const size = (title?.size ?? 96) * (height / 1080);
  const subSize = (subtitle?.size ?? 40) * (height / 1080);

  const ruleP = easeOut(clamp01((frame - Math.round(0.15 * fps)) / Math.round(0.55 * fps)));
  const subP = easeOut(clamp01((frame - Math.round(0.5 * fps)) / Math.round(0.5 * fps)));

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at 30% 20%, ${tokens.colors.bg} 0%, ${tokens.colors.bgDeep} 70%)`,
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8%',
      }}
    >
      <div style={{textAlign: 'center', maxWidth: '100%'}}>
        <div
          style={{
            fontFamily: tokens.fonts.title,
            fontWeight: 800,
            fontSize: size,
            color: title?.color ?? tokens.colors.fg,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: `0 ${size * 0.28}px`,
          }}
        >
          {words.map((w, i) => {
            const delay = Math.round((0.06 * i + 0.12) * fps);
            const p = easeOutBack(clamp01((frame - delay) / Math.round(0.45 * fps)));
            const accent = title?.emphasis?.some((e) => e.toLowerCase() === w.toLowerCase());
            return (
              <span
                key={i}
                style={{
                  opacity: p,
                  transform: `translateY(${((1 - p) * size * 0.45).toFixed(1)}px)`,
                  display: 'inline-block',
                  color: accent ? tokens.colors.highlight : undefined,
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
        <div
          style={{
            width: `${ruleP * Math.min(width * 0.4, size * 4)}px`,
            height: Math.max(3, height * 0.005),
            background: tokens.colors.accent,
            margin: `${height * 0.035}px auto 0`,
            borderRadius: 4,
          }}
        />
        {subtitle ? (
          <div
            style={{
              marginTop: height * 0.03,
              fontFamily: tokens.fonts.body,
              fontWeight: 500,
              fontSize: subSize,
              color: subtitle.color ?? tokens.colors.muted,
              opacity: subP,
              transform: `translateY(${((1 - subP) * 16).toFixed(1)}px)`,
            }}
          >
            {subtitle.text}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/**
 * CardScene — location / time / label card ("11:00 PM", "Lighthouse, Maine").
 * Restrained: a small label, a drawn rule, a supporting line.
 */
export const CardScene: React.FC<SceneComponentProps> = ({scene, tokens}) => {
  const frame = useCurrentFrame();
  const {fps, height, width} = useVideoConfig();
  const main = scene.text?.[0];
  const sub = scene.text?.[1];
  const mainSize = (main?.size ?? 72) * (height / 1080);
  const ruleP = easeOut(clamp01((frame - Math.round(0.2 * fps)) / Math.round(0.6 * fps)));
  const mainP = easeOut(clamp01(frame / Math.round(0.5 * fps)));
  const subP = easeOut(clamp01((frame - Math.round(0.35 * fps)) / Math.round(0.5 * fps)));

  const align = (main?.x ?? 0.5) < 0.4 ? 'flex-start' : (main?.x ?? 0.5) > 0.6 ? 'flex-end' : 'center';

  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: align,
          width: '80%',
          opacity: mainP,
        }}
      >
        <div
          style={{
            fontFamily: tokens.fonts.mono,
            fontSize: mainSize * 0.42,
            letterSpacing: '0.42em',
            textTransform: 'uppercase',
            color: tokens.colors.accent,
            marginBottom: height * 0.018,
          }}
        >
          {scene.purpose === 'outro' ? 'FIN' : ''}
          {main?.text ?? ''}
        </div>
        <div
          style={{
            width: `${ruleP * 100}%`,
            height: 2,
            background: `linear-gradient(90deg, ${tokens.colors.accent}, transparent)`,
            marginBottom: height * 0.02,
          }}
        />
        {sub ? (
          <div
            style={{
              fontFamily: tokens.fonts.title,
              fontSize: mainSize,
              fontWeight: 700,
              color: sub.color ?? tokens.colors.fg,
              opacity: subP,
              transform: `translateY(${((1 - subP) * 14).toFixed(1)}px)`,
              maxWidth: '100%',
              textAlign: align === 'flex-start' ? 'left' : align === 'flex-end' ? 'right' : 'center',
            }}
          >
            {sub.text}
          </div>
        ) : null}
      </div>
      {/* position hint respected on x for the whole block */}
      <div style={{position: 'absolute', width, height, pointerEvents: 'none'}} />
    </AbsoluteFill>
  );
};