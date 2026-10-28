import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {StyleTokens} from '../styles/tokens';

/**
 * Grade — deterministic post treatment: vignette, film grain, color tint.
 * Values come from the style tokens, so "more cinematic" is a style change,
 * not an effect sprinkle.
 */
export const Grade: React.FC<{tokens: StyleTokens; width: number; height: number}> = ({tokens}) => {
  const {vignette, grain, tint} = tokens.grade;
  return (
    <>
      {tint && tint !== 'rgba(0,0,0,0)' ? (
        <AbsoluteFill style={{background: tint, mixBlendMode: 'multiply', pointerEvents: 'none'}} />
      ) : null}
      {vignette > 0 ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 75% 75% at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,${vignette.toFixed(
              3,
            )}) 100%)`,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {grain > 0 ? <Grain amount={grain} /> : null}
    </>
  );
};

/** Static-baked SVG grain (seeded turbulence — identical across renders). */
const Grain: React.FC<{amount: number}> = ({amount}) => (
  <AbsoluteFill style={{opacity: amount, pointerEvents: 'none', mixBlendMode: 'overlay'}}>
    <svg width="100%" height="100%">
      <filter id="engine-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" seed="7" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#engine-grain)" />
    </svg>
  </AbsoluteFill>
);