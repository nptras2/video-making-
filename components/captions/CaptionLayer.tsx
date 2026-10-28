/**
 * CaptionLayer — professional synchronized captions.
 *
 * Modes: phrase (default), sentence, word-by-word karaoke. Word timings come
 * from the STT transcript when available; otherwise word timing is distributed
 * evenly across the cue so the mode still behaves correctly.
 */
import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CaptionCue, CaptionStyle} from '../../engine/types';
import type {StyleTokens} from '../../styles/tokens';
import {clamp01} from '../lib/anim';

export interface CaptionLayerProps {
  cues: CaptionCue[];
  style: CaptionStyle;
  tokens: StyleTokens;
}

const splitWords = (cue: CaptionCue): Array<{text: string; startMs: number; endMs: number}> => {
  if (cue.words && cue.words.length > 0) return cue.words;
  const parts = cue.text.split(/\s+/).filter(Boolean);
  const span = cue.endMs - cue.startMs;
  return parts.map((text, i) => ({
    text,
    startMs: cue.startMs + (span * i) / parts.length,
    endMs: cue.startMs + (span * (i + 1)) / parts.length,
  }));
};

export const CaptionLayer: React.FC<CaptionLayerProps> = ({cues, style, tokens}) => {
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {cues.map((cue, i) => {
        const from = Math.floor((cue.startMs / 1000) * fps);
        const dur = Math.max(1, Math.ceil(((cue.endMs - cue.startMs) / 1000) * fps));
        return (
          <Sequence key={`${cue.startMs}-${i}`} from={from} durationInFrames={dur} name={`cue-${i}`}>
            <CueView cue={cue} style={style} tokens={tokens} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const CueView: React.FC<{cue: CaptionCue; style: CaptionStyle; tokens: StyleTokens}> = ({cue, style, tokens}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const absMs = cue.startMs + (frame / fps) * 1000;
  const words = splitWords(cue);
  const size = (style.size ?? 52) * (height / 1080);
  const top = (style.position ?? 0.78) * 100;

  const enterMs = 100;
  const exitMs = 120;
  const localMs = (frame / fps) * 1000;
  const totalMs = ((cue.endMs - cue.startMs) / 1000) * 1000;
  const opacity =
    clamp01(localMs / enterMs) * clamp01((totalMs - localMs) / exitMs);
  const rise = (1 - clamp01(localMs / enterMs)) * 12;

  const fontFamily = style.font ?? tokens.fonts.body;
  const textTransform = style.uppercase ? 'uppercase' : 'none';
  const highlight = style.highlightColor ?? tokens.colors.highlight;
  const baseColor = style.color ?? tokens.colors.fg;
  const stroke = style.stroke ?? 'rgba(0,0,0,0.7)';

  const renderWord = (w: {text: string; startMs: number; endMs: number}, i: number, arr: typeof words) => {
    const active = absMs >= w.startMs && absMs < w.endMs + 60;
    const past = absMs >= w.endMs + 60;
    const isLast = i === arr.length - 1;
    const wordStyle: React.CSSProperties = {
      display: 'inline-block',
      marginRight: size * 0.3,
      color:
        style.mode === 'word'
          ? active || past
            ? highlight
            : baseColor
          : active && style.mode !== 'phrase'
            ? highlight
            : baseColor,
      opacity: style.mode === 'word' ? (active ? 1 : past ? 0.75 : 0.55) : 1,
      transform: active && style.mode === 'word' ? 'scale(1.06)' : 'scale(1)',
      transition: 'none',
    };
    void isLast;
    return (
      <span key={i} style={wordStyle}>
        {w.text}
      </span>
    );
  };

  const body =
    style.mode === 'phrase' || style.mode === 'sentence'
      ? cue.text
      : null;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          top: `${top}%`,
          left: '50%',
          transform: `translate(-50%, -50%) translateY(${rise.toFixed(1)}px)`,
          opacity,
          maxWidth: '88%',
          textAlign: 'center',
          fontFamily,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.3,
          textTransform,
          textShadow: `0 0 ${size * 0.12}px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.9)`,
          WebkitTextStroke: `${Math.max(0.5, size * 0.028)}px ${stroke}`,
          paintOrder: 'stroke fill',
          padding: style.background ? `${size * 0.28}px ${size * 0.5}px` : 0,
          borderRadius: style.background ? size * 0.22 : 0,
          background: style.background ?? 'transparent',
          boxDecorationBreak: 'clone',
        } as React.CSSProperties}
      >
        {body ?? words.map(renderWord)}
      </div>
    </AbsoluteFill>
  );
};