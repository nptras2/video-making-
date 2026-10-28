import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {OverlaySpec} from '../../engine/types';
import type {StyleTokens} from '../../styles/tokens';
import {clamp01, easeOut, easeOutBack} from '../lib/anim';

/**
 * GraphicOverlay — reusable, animatable graphic primitives:
 * lower-third, callout, stat, logo, progress bar.
 * Every effect here exists to communicate information, never as decoration.
 */
export const GraphicOverlay: React.FC<{overlay: OverlaySpec; tokens: StyleTokens}> = ({overlay, tokens}) => {
  switch (overlay.kind) {
    case 'lower-third':
      return <LowerThird overlay={overlay} tokens={tokens} />;
    case 'stat':
      return <StatCard overlay={overlay} tokens={tokens} />;
    case 'callout':
      return <Callout overlay={overlay} tokens={tokens} />;
    case 'progress':
      return <Progress overlay={overlay} tokens={tokens} />;
    case 'logo':
      return <Logo overlay={overlay} tokens={tokens} />;
    default:
      return null;
  }
};

const anchorStyle = (pos: OverlaySpec['position']): React.CSSProperties => {
  switch (pos) {
    case 'top-left':
      return {top: '7%', left: '6%', alignItems: 'flex-start'};
    case 'top-right':
      return {top: '7%', right: '6%', alignItems: 'flex-end'};
    case 'center':
      return {top: '50%', left: '50%', transform: 'translate(-50%,-50%)', alignItems: 'center'};
    case 'bottom-right':
      return {bottom: '8%', right: '6%', alignItems: 'flex-end'};
    case 'bottom-left':
    default:
      return {bottom: '14%', left: '6%', alignItems: 'flex-start'};
  }
};

const LowerThird: React.FC<{overlay: OverlaySpec; tokens: StyleTokens}> = ({overlay, tokens}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const p = easeOut(clamp01(frame / Math.round(0.45 * fps)));
  const barGrow = easeOut(clamp01((frame - Math.round(0.1 * fps)) / Math.round(0.5 * fps)));
  const out = clamp01(((overlay.duration * fps - frame) / Math.round(0.3 * fps)));
  const size = height / 1080;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          ...anchorStyle(overlay.position),
          display: 'flex',
          flexDirection: 'column',
          opacity: p * out,
          transform: `${anchorStyle(overlay.position).transform ?? ''} translateX(${(1 - p) * -40}px)`,
        }}
      >
        <div
          style={{
            width: `${barGrow * 4}px`,
            height: `${(54 * size).toFixed(0)}px`,
            background: tokens.colors.accent,
            position: 'absolute',
            left: -14 * size,
            top: 0,
            borderRadius: 4,
          }}
        />
        <div
          style={{
            fontFamily: tokens.fonts.body,
            fontWeight: 800,
            fontSize: 46 * size,
            color: tokens.colors.fg,
            letterSpacing: '0.01em',
            textShadow: '0 2px 12px rgba(0,0,0,0.6)',
          }}
        >
          {overlay.title}
        </div>
        {overlay.subtitle ? (
          <div
            style={{
              fontFamily: tokens.fonts.body,
              fontWeight: 500,
              fontSize: 30 * size,
              color: tokens.colors.muted,
              marginTop: 4 * size,
              opacity: clamp01((frame - Math.round(0.25 * fps)) / Math.round(0.4 * fps)),
            }}
          >
            {overlay.subtitle}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const StatCard: React.FC<{overlay: OverlaySpec; tokens: StyleTokens}> = ({overlay, tokens}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const size = height / 1080;
  const p = easeOutBack(clamp01(frame / Math.round(0.5 * fps)));
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          ...anchorStyle(overlay.position ?? 'center'),
          display: 'flex',
          flexDirection: 'column',
          opacity: p,
          transform: `${anchorStyle(overlay.position ?? 'center').transform ?? ''} scale(${(0.85 + 0.15 * p).toFixed(3)})`,
          background: 'rgba(0,0,0,0.45)',
          border: `2px solid ${tokens.colors.accent}`,
          borderRadius: 18 * size,
          padding: `${26 * size}px ${40 * size}px`,
          backdropFilter: 'blur(6px)',
        }}
      >
        <div
          style={{
            fontFamily: tokens.fonts.title,
            fontWeight: 900,
            fontSize: 96 * size,
            color: tokens.colors.highlight,
            lineHeight: 1,
          }}
        >
          {overlay.value}
        </div>
        {overlay.title ? (
          <div
            style={{
              fontFamily: tokens.fonts.body,
              fontWeight: 600,
              fontSize: 32 * size,
              color: tokens.colors.fg,
              marginTop: 10 * size,
              maxWidth: 520 * size,
            }}
          >
            {overlay.title}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** Callout — arrow/circle highlight that draws on and points at something. */
const Callout: React.FC<{overlay: OverlaySpec; tokens: StyleTokens}> = ({overlay, tokens}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const size = height / 1080;
  const draw = easeOut(clamp01(frame / Math.round(0.5 * fps)));
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          ...anchorStyle(overlay.position ?? 'center'),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: draw,
        }}
      >
        <svg width={220 * size} height={140 * size} viewBox="0 0 220 140">
          <circle
            cx="70"
            cy="70"
            r="52"
            fill="none"
            stroke={tokens.colors.accent}
            strokeWidth={5}
            strokeDasharray={327}
            strokeDashoffset={327 * (1 - draw)}
            strokeLinecap="round"
          />
          <path
            d="M118 96 L188 128"
            stroke={tokens.colors.accent}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={80}
            strokeDashoffset={80 * (1 - draw)}
          />
        </svg>
        {overlay.title ? (
          <div
            style={{
              fontFamily: tokens.fonts.body,
              fontWeight: 700,
              fontSize: 40 * size,
              color: tokens.colors.fg,
              background: 'rgba(0,0,0,0.5)',
              padding: `${8 * size}px ${18 * size}px`,
              borderRadius: 10,
              marginTop: 8 * size,
            }}
          >
            {overlay.title}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** Progress — watch-time / chapter progress indicator. */
const Progress: React.FC<{overlay: OverlaySpec; tokens: StyleTokens}> = ({overlay, tokens}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = clamp01(frame / Math.max(1, overlay.duration * fps));
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '100%',
          height: 8,
          background: 'rgba(255,255,255,0.15)',
        }}
      >
        <div style={{width: `${p * 100}%`, height: '100%', background: tokens.colors.accent}} />
      </div>
    </AbsoluteFill>
  );
};

const Logo: React.FC<{overlay: OverlaySpec; tokens: StyleTokens}> = ({overlay}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const p = easeOut(clamp01(frame / Math.round(0.5 * fps)));
  const size = height / 1080;
  if (!overlay.src) return null;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div style={{position: 'absolute', ...anchorStyle(overlay.position ?? 'top-right'), opacity: p}}>
        <Img src={staticFile(overlay.src)} style={{height: 72 * size, display: 'block'}} />
      </div>
    </AbsoluteFill>
  );
};