/**
 * Style engine — token source of truth for look & feel.
 *
 * This module holds the machine-readable tokens the renderer consumes (colors,
 * typography, motion intensity, caption style, transition defaults, grade).
 * The creative rules and when-to-use guidance for each style are documented in
 * STYLES.md; add a style by adding an entry here and a section there.
 */
import type {CaptionStyle, SceneTransition} from '../engine/types';

export interface StyleTokens {
  name: string;
  label: string;
  fonts: {title: string; body: string; mono: string};
  colors: {
    bg: string;
    bgDeep: string;
    fg: string;
    muted: string;
    accent: string;
    accent2: string;
    highlight: string;
  };
  motion: {
    /** 0..1 — how aggressive animation is. Editorial styles stay low. */
    intensity: number;
    cameraSpeed: number;
    ease: (t: number) => number;
  };
  caption: CaptionStyle;
  transition: SceneTransition;
  grade: {
    vignette: number; // 0..1
    grain: number; // 0..1
    tint: string; // rgba overlay
  };
}

const outCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const STYLES: Record<string, StyleTokens> = {
  cinematic: {
    name: 'cinematic',
    label: 'Cinematic',
    fonts: {title: '"Georgia", "Times New Roman", serif', body: '"Segoe UI", "Helvetica Neue", Arial, sans-serif', mono: '"Consolas", "Courier New", monospace'},
    colors: {bg: '#0b0d12', bgDeep: '#05060a', fg: '#f4f1ea', muted: '#9aa0ad', accent: '#d9a441', accent2: '#3f6fa8', highlight: '#ffd98a'},
    motion: {intensity: 0.45, cameraSpeed: 0.5, ease: inOutCubic},
    caption: {mode: 'phrase', color: '#f4f1ea', highlightColor: '#ffd98a', stroke: 'rgba(0,0,0,0.75)', position: 0.78, size: 54},
    transition: {type: 'dissolve', duration: 0.5},
    grade: {vignette: 0.35, grain: 0.06, tint: 'rgba(10,14,24,0.10)'},
  },
  documentary: {
    name: 'documentary',
    label: 'Documentary',
    fonts: {title: '"Georgia", serif', body: '"Segoe UI", Arial, sans-serif', mono: '"Consolas", monospace'},
    colors: {bg: '#111417', bgDeep: '#080a0c', fg: '#eceae4', muted: '#a8adb5', accent: '#c9b47a', accent2: '#5b7d99', highlight: '#ffe9b0'},
    motion: {intensity: 0.3, cameraSpeed: 0.35, ease: outCubic},
    caption: {mode: 'sentence', color: '#eceae4', highlightColor: '#ffe9b0', stroke: 'rgba(0,0,0,0.7)', position: 0.8, size: 46},
    transition: {type: 'fade', duration: 0.6},
    grade: {vignette: 0.25, grain: 0.05, tint: 'rgba(20,24,32,0.08)'},
  },
  youtube: {
    name: 'youtube',
    label: 'YouTube',
    fonts: {title: '"Arial Black", "Segoe UI", sans-serif', body: '"Segoe UI", Arial, sans-serif', mono: '"Consolas", monospace'},
    colors: {bg: '#14161d', bgDeep: '#0a0b10', fg: '#ffffff', muted: '#b9bec8', accent: '#ff3b5c', accent2: '#2ec4ff', highlight: '#ffe14d'},
    motion: {intensity: 0.7, cameraSpeed: 0.8, ease: outCubic},
    caption: {mode: 'word', color: '#ffffff', highlightColor: '#ffe14d', stroke: 'rgba(0,0,0,0.85)', position: 0.76, size: 62, uppercase: false},
    transition: {type: 'slide', duration: 0.3},
    grade: {vignette: 0.2, grain: 0.03, tint: 'rgba(0,0,0,0)'},
  },
  reels: {
    name: 'reels',
    label: 'Reels / Shorts',
    fonts: {title: '"Arial Black", "Segoe UI", sans-serif', body: '"Segoe UI", Arial, sans-serif', mono: '"Consolas", monospace'},
    colors: {bg: '#0e0f14', bgDeep: '#050508', fg: '#ffffff', muted: '#c5c9d4', accent: '#00e5a0', accent2: '#ff5d8f', highlight: '#fff36b'},
    motion: {intensity: 0.8, cameraSpeed: 1, ease: outCubic},
    caption: {mode: 'word', color: '#ffffff', highlightColor: '#fff36b', stroke: 'rgba(0,0,0,0.9)', position: 0.72, size: 64, uppercase: true, background: 'rgba(0,0,0,0.35)'},
    transition: {type: 'slide', duration: 0.25},
    grade: {vignette: 0.15, grain: 0.02, tint: 'rgba(0,0,0,0)'},
  },
  corporate: {
    name: 'corporate',
    label: 'Corporate',
    fonts: {title: '"Segoe UI", Arial, sans-serif', body: '"Segoe UI", Arial, sans-serif', mono: '"Consolas", monospace'},
    colors: {bg: '#f7f8fa', bgDeep: '#e9ecf1', fg: '#1a2233', muted: '#5c6675', accent: '#1f5eff', accent2: '#0fb5a8', highlight: '#1f5eff'},
    motion: {intensity: 0.35, cameraSpeed: 0.4, ease: outCubic},
    caption: {mode: 'phrase', color: '#1a2233', highlightColor: '#1f5eff', position: 0.82, size: 44},
    transition: {type: 'fade', duration: 0.4},
    grade: {vignette: 0, grain: 0, tint: 'rgba(0,0,0,0)'},
  },
  minimal: {
    name: 'minimal',
    label: 'Minimal',
    fonts: {title: '"Segoe UI", Arial, sans-serif', body: '"Segoe UI", Arial, sans-serif', mono: '"Consolas", monospace'},
    colors: {bg: '#ffffff', bgDeep: '#f2f2f2', fg: '#111111', muted: '#767676', accent: '#111111', accent2: '#8a8a8a', highlight: '#111111'},
    motion: {intensity: 0.2, cameraSpeed: 0.25, ease: outCubic},
    caption: {mode: 'sentence', color: '#111111', highlightColor: '#111111', position: 0.85, size: 40},
    transition: {type: 'fade', duration: 0.4},
    grade: {vignette: 0, grain: 0, tint: 'rgba(0,0,0,0)'},
  },
  '2d-animation': {
    name: '2d-animation',
    label: '2D Animation',
    fonts: {title: '"Segoe UI", Arial, sans-serif', body: '"Segoe UI", Arial, sans-serif', mono: '"Consolas", monospace'},
    colors: {bg: '#0d1424', bgDeep: '#060a15', fg: '#f3f6ff', muted: '#a9b4cc', accent: '#f6c453', accent2: '#5ad1e6', highlight: '#ffd88a'},
    motion: {intensity: 0.6, cameraSpeed: 0.6, ease: inOutCubic},
    caption: {mode: 'phrase', color: '#f3f6ff', highlightColor: '#ffd88a', stroke: 'rgba(0,0,0,0.7)', position: 0.8, size: 50},
    transition: {type: 'dissolve', duration: 0.5},
    grade: {vignette: 0.3, grain: 0.04, tint: 'rgba(8,16,38,0.10)'},
  },
  '3d-motion': {
    name: '3d-motion',
    label: '3D Motion Graphics',
    fonts: {title: '"Segoe UI", Arial, sans-serif', body: '"Segoe UI", Arial, sans-serif', mono: '"Consolas", monospace'},
    colors: {bg: '#07090f', bgDeep: '#020306', fg: '#ffffff', muted: '#8f97a8', accent: '#4de1ff', accent2: '#8b5cff', highlight: '#a8ffea'},
    motion: {intensity: 0.7, cameraSpeed: 0.9, ease: inOutCubic},
    caption: {mode: 'phrase', color: '#ffffff', highlightColor: '#4de1ff', stroke: 'rgba(0,0,0,0.8)', position: 0.8, size: 48},
    transition: {type: 'fade', duration: 0.4},
    grade: {vignette: 0.4, grain: 0.05, tint: 'rgba(4,8,20,0.12)'},
  },
  'horror-story': {
    name: 'horror-story',
    label: 'Horror Story',
    fonts: {title: '"Georgia", serif', body: '"Segoe UI", Arial, sans-serif', mono: '"Consolas", monospace'},
    colors: {bg: '#07070a', bgDeep: '#000000', fg: '#d8d4cc', muted: '#7d7a74', accent: '#a11d2f', accent2: '#3d3a36', highlight: '#e8b4b4'},
    motion: {intensity: 0.4, cameraSpeed: 0.3, ease: inOutCubic},
    caption: {mode: 'sentence', color: '#d8d4cc', highlightColor: '#e8b4b4', stroke: 'rgba(0,0,0,0.9)', position: 0.78, size: 48},
    transition: {type: 'dissolve', duration: 0.8},
    grade: {vignette: 0.6, grain: 0.1, tint: 'rgba(10,6,8,0.25)'},
  },
  explainer: {
    name: 'explainer',
    label: 'Explainer',
    fonts: {title: '"Segoe UI", Arial, sans-serif', body: '"Segoe UI", Arial, sans-serif', mono: '"Consolas", monospace'},
    colors: {bg: '#101828', bgDeep: '#0a0f1c', fg: '#ffffff', muted: '#aeb7c9', accent: '#ffb703', accent2: '#4cc9f0', highlight: '#ffe066'},
    motion: {intensity: 0.6, cameraSpeed: 0.6, ease: outCubic},
    caption: {mode: 'phrase', color: '#ffffff', highlightColor: '#ffe066', stroke: 'rgba(0,0,0,0.8)', position: 0.8, size: 50},
    transition: {type: 'fade', duration: 0.35},
    grade: {vignette: 0.15, grain: 0.02, tint: 'rgba(0,0,0,0)'},
  },
  advertisement: {
    name: 'advertisement',
    label: 'Advertisement',
    fonts: {title: '"Arial Black", Arial, sans-serif', body: '"Segoe UI", Arial, sans-serif', mono: '"Consolas", monospace'},
    colors: {bg: '#101014', bgDeep: '#050507', fg: '#ffffff', muted: '#c3c6cf', accent: '#ff4d00', accent2: '#00d1ff', highlight: '#fff200'},
    motion: {intensity: 0.75, cameraSpeed: 0.85, ease: outCubic},
    caption: {mode: 'word', color: '#ffffff', highlightColor: '#fff200', stroke: 'rgba(0,0,0,0.9)', position: 0.75, size: 58, uppercase: true},
    transition: {type: 'slide', duration: 0.25},
    grade: {vignette: 0.2, grain: 0.03, tint: 'rgba(0,0,0,0)'},
  },
};

export function getStyle(name: string): StyleTokens {
  return STYLES[name] ?? STYLES.cinematic;
}

export const STYLE_NAMES = Object.keys(STYLES);