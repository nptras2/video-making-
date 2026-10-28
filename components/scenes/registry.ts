/**
 * Scene registry — the plugin surface of the engine.
 *
 * Adding a scene type = writing a component + adding one line here. The
 * planner emits scene.type strings; VideoHost resolves them through this map.
 */
import type React from 'react';
import type {SceneType} from '../../engine/types';
import type {SceneComponentProps} from './ClipScene';
import {ClipScene, ImageScene} from './ClipScene';
import {TitleScene, CardScene} from './TitleScene';
import {AbstractScene} from './AbstractScene';
import {TwoDScene} from './TwoDScene';
import {ThreeDScene} from './ThreeDScene';

export type SceneComponent = React.FC<SceneComponentProps>;

export const registry: Record<SceneType, SceneComponent> = {
  clip: ClipScene,
  image: ImageScene,
  title: TitleScene,
  card: CardScene,
  abstract: AbstractScene,
  'two-d': TwoDScene,
  'three-d': ThreeDScene,
};