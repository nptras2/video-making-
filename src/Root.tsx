import React from 'react';
import {Composition, type CalculateMetadataFunction} from 'remotion';
import {VideoHost, type VideoHostProps} from '../components/VideoHost';
import type {VideoPlan} from '../engine/types';
import demoPlan from '../templates/demo-plan.json';

/**
 * Single dynamic composition. Everything (ratio, fps, duration, scenes) comes
 * from the VideoPlan passed as inputProps — the engine writes a props file per
 * project and renders `Main`. No per-video composition code, ever.
 */
export const Root: React.FC = () => {
  return (
    <Composition
      id="Main"
      component={VideoHost}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={180}
      defaultProps={{plan: demoPlan as unknown as VideoPlan}}
      calculateMetadata={calculateMetadata}
    />
  );
};

const calculateMetadata: CalculateMetadataFunction<VideoHostProps> = ({props}) => {
  const plan = props.plan;
  const fps = plan.format?.fps ?? 30;
  const width = plan.format?.width ?? 1920;
  const height = plan.format?.height ?? 1080;
  const durationInFrames = Math.max(1, Math.round((plan.duration ?? 6) * fps));
  return {
    width,
    height,
    fps,
    durationInFrames,
    props,
  };
};