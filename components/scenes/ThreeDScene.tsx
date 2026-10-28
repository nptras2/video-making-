/**
 * ThreeDScene — 3D motion graphics via React Three Fiber (inside @remotion/three
 * so WebGL frames are captured deterministically).
 *
 * All motion derives from useCurrentFrame() — never accumulating deltas — so
 * every render of frame N is identical.
 *
 * scene.data knobs:
 *   shape:  'box'|'sphere'|'torus'|'icosahedron'|'octahedron'|'cone' (default torus)
 *   count:  number of orbiting objects (default 12)
 *   spread: orbit radius (default 3.2)
 *   variant:'orbit' | 'grid' | 'explode'
 *   glow:   boolean — emissive materials + bloom-ish sprite halos
 *   chart:  number[] — bars instead of orbiters
 *   spin:   radians/sec base spin (default 0.6)
 */
import React, {useMemo} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {PerspectiveCamera} from '@react-three/drei';
import type {Scene} from '../../engine/types';
import type {StyleTokens} from '../../styles/tokens';
import type {SceneComponentProps} from './ClipScene';
import {SceneText} from '../lib/SceneText';
import {clamp01, rand01} from '../lib/anim';

type ShapeKind = 'box' | 'sphere' | 'torus' | 'icosahedron' | 'octahedron' | 'cone';

const Geometry: React.FC<{kind: ShapeKind}> = ({kind}) => {
  switch (kind) {
    case 'box':
      return <boxGeometry args={[1, 1, 1]} />;
    case 'sphere':
      return <sphereGeometry args={[0.7, 32, 32]} />;
    case 'torus':
      return <torusGeometry args={[0.75, 0.3, 24, 64]} />;
    case 'icosahedron':
      return <icosahedronGeometry args={[0.85, 0]} />;
    case 'octahedron':
      return <octahedronGeometry args={[0.9, 0]} />;
    case 'cone':
      return <coneGeometry args={[0.7, 1.4, 32]} />;
    default:
      return <boxGeometry args={[1, 1, 1]} />;
  }
};

const CameraRig: React.FC<{t: number; radius: number; height: number; intensity: number}> = ({t, radius, height, intensity}) => {
  const angle = -Math.PI / 3 + t * Math.PI * 0.5 * intensity;
  return (
    <PerspectiveCamera
      makeDefault
      fov={42}
      position={[Math.sin(angle) * radius, height - t * height * 0.35, Math.cos(angle) * radius]}
      onUpdate={(self) => self.lookAt(0, 0, 0)}
    />
  );
};

interface Orbiter {
  i: number;
  radius: number;
  angle: number;
  tilt: number;
  speed: number;
  scale: number;
}

const SceneContent: React.FC<{scene: Scene; tokens: StyleTokens; t: number; frame: number; fps: number}> = ({
  scene,
  tokens,
  t,
  frame,
  fps,
}) => {
  const d = scene.data ?? {};
  const kind = (d.shape as ShapeKind) ?? 'torus';
  const variant = (d.variant as string) ?? 'orbit';
  const count = (d.count as number) ?? 12;
  const spread = (d.spread as number) ?? 3.2;
  const spin = (d.spin as number) ?? 0.6;
  const glow = (d.glow as boolean | undefined) ?? true;
  const accent = tokens.colors.accent;
  const accent2 = tokens.colors.accent2;

  const orbiters: Orbiter[] = useMemo(
    () =>
      new Array(count).fill(0).map((_, i) => ({
        i,
        radius: spread * (0.55 + rand01(i * 3 + 1) * 0.75),
        angle: (i / count) * Math.PI * 2 + rand01(i * 3 + 2) * 0.9,
        tilt: (rand01(i * 3 + 3) - 0.5) * 1.6,
        speed: 0.5 + rand01(i * 3 + 4) * 1.1,
        scale: 0.4 + rand01(i * 3 + 5) * 0.8,
      })),
    [count, spread],
  );

  const bars = d.chart as number[] | undefined;
  const centralSpin = frame / fps * spin;

  return (
    <>
      <CameraRig t={t} radius={8.4} height={3.4} intensity={1} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[5, 6, 4]} intensity={1.6} color="#ffffff" />
      <pointLight position={[-6, -3, -4]} intensity={2.2} color={accent2} />

      {/* central object */}
      <mesh rotation={[centralSpin * 0.7, centralSpin, centralSpin * 0.3]}>
        <Geometry kind={kind} />
        <meshStandardMaterial
          color={accent}
          metalness={0.85}
          roughness={0.22}
          emissive={glow ? accent : '#000000'}
          emissiveIntensity={glow ? 0.35 + 0.25 * Math.sin(t * Math.PI * 2) : 0}
        />
      </mesh>

      {/* orbiting objects */}
      {!bars
        ? orbiters.map((o) => {
            const a = o.angle + (variant === 'explode' ? t * 3 * o.speed : t * Math.PI * 2 * o.speed);
            const r = variant === 'explode' ? o.radius * (1 + t * 1.6) : o.radius;
            const y = Math.sin(a * 1.3 + o.tilt) * (variant === 'grid' ? 0.2 : 1.4) + o.tilt;
            return (
              <mesh key={o.i} position={[Math.cos(a) * r, y, Math.sin(a) * r]} rotation={[a, a * 0.7, 0]}>
                <Geometry kind={kind === 'torus' ? 'icosahedron' : 'torus'} />
                <meshStandardMaterial
                  color={o.i % 2 === 0 ? accent2 : tokens.colors.fg}
                  metalness={0.7}
                  roughness={0.3}
                  emissive={glow && o.i % 2 === 0 ? accent2 : '#000000'}
                  emissiveIntensity={0.3}
                />
              </mesh>
            );
          })
        : null}

      {/* chart bars variant */}
      {bars
        ? bars.map((v, i) => {
            const grow = clamp01((t - i * 0.05) * 3.5);
            const h = Math.max(0.05, v * 3.4 * grow);
            const x = (i - (bars.length - 1) / 2) * 1.5;
            return (
              <mesh key={i} position={[x, h / 2 - 1.6, 0]}>
                <boxGeometry args={[1, h, 1]} />
                <meshStandardMaterial
                  color={i % 2 === 0 ? accent : accent2}
                  metalness={0.6}
                  roughness={0.35}
                  emissive={i % 2 === 0 ? accent : accent2}
                  emissiveIntensity={0.25}
                />
              </mesh>
            );
          })
        : null}

      {/* particle field */}
      <ParticleField frame={frame} fps={fps} t={t} accent={accent} />
    </>
  );
};

const ParticleField: React.FC<{frame: number; fps: number; t: number; accent: string}> = ({frame, fps, t, accent}) => {
  const positions = useMemo(() => {
    const arr = new Float32Array(240 * 3);
    for (let i = 0; i < 240; i++) {
      arr[i * 3] = (rand01(i * 3 + 11) - 0.5) * 22;
      arr[i * 3 + 1] = (rand01(i * 3 + 12) - 0.5) * 14;
      arr[i * 3 + 2] = (rand01(i * 3 + 13) - 0.5) * 18;
    }
    return arr;
  }, []);
  void frame;
  void fps;
  return (
    <points rotation={[0, t * Math.PI * 0.4, 0]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.06} color={accent} transparent opacity={0.75} sizeAttenuation />
    </points>
  );
};

export const ThreeDScene: React.FC<SceneComponentProps> = ({scene, tokens}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const dur = Math.max(1, Math.round(scene.duration * fps));
  const t = clamp01(frame / dur);

  return (
    <AbsoluteFill style={{background: `radial-gradient(ellipse at 50% 40%, ${tokens.colors.bg} 0%, ${tokens.colors.bgDeep} 72%)`}}>
      <ThreeCanvas
        width={width}
        height={height}
        style={{position: 'absolute', inset: 0}}
        gl={{antialias: true, alpha: true}}
      >
        <SceneContent scene={scene} tokens={tokens} t={t} frame={frame} fps={fps} />
      </ThreeCanvas>
      {scene.text && scene.text.length > 0 ? <SceneText scene={scene} tokens={tokens} /> : null}
    </AbsoluteFill>
  );
};