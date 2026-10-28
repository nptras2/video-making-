/**
 * Storyboard writer — turns a VideoPlan into STORYBOARD.md.
 *
 * The plan is the machine contract; the storyboard is the human one. It is
 * generated from the same data, so it can never drift from what renders.
 */
import type {FormatSpec, Scene, VideoPlan} from '../types';
import {getStyle} from '../../styles/tokens';

const tc = (seconds: number): string => {
  const s = Math.max(0, seconds);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const ff = Math.round((s - Math.floor(s)) * 30);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
};

const SCENE_LABEL: Record<Scene['type'], string> = {
  clip: 'Footage',
  image: 'Still image',
  title: 'Title',
  card: 'Card',
  'two-d': '2D animation',
  'three-d': '3D motion graphics',
  abstract: 'Procedural motion',
};

const describeLayers = (scene: Scene): string => {
  if (!scene.layers || scene.layers.length === 0) return '';
  return scene.layers
    .slice()
    .sort((a, b) => a.depth - b.depth)
    .map((l) => `${l.asset}@${l.depth.toFixed(2)}`)
    .join(' → ');
};

const describeEffects = (scene: Scene): string => {
  const effects = scene.data?.effects as string | undefined;
  const beam = scene.data?.beam as {x: number; y: number} | undefined;
  const variant = scene.data?.variant as string | undefined;
  const shape = scene.data?.shape as string | undefined;
  const bits: string[] = [];
  if (effects && effects !== 'none') bits.push(effects);
  if (beam) bits.push('rotating light beam');
  if (shape) bits.push(`${shape} geometry`);
  if (variant) bits.push(`variant: ${variant}`);
  if (scene.data?.punchIn) bits.push(`punch-in ${scene.data.punchIn}`);
  if (scene.data?.trimBeforeSec != null) bits.push(`source trim @${Number(scene.data.trimBeforeSec).toFixed(2)}s`);
  return bits.join(', ');
};

export interface StoryboardMeta {
  projectId?: string;
  mode?: string;
  format: FormatSpec;
  style: string;
  providers?: string[];
  notes?: string[];
  /** asset credits (stock attribution) */
  credits?: string[];
}

export function renderStoryboard(plan: VideoPlan, meta: StoryboardMeta): string {
  const tokens = getStyle(plan.style);
  const out: string[] = [];

  out.push(`# Storyboard — ${plan.title ?? 'Untitled'}`);
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  if (meta.projectId) out.push(`| Project | \`${meta.projectId}\` |`);
  if (meta.mode) out.push(`| Input mode | ${meta.mode} |`);
  out.push(`| Format | ${plan.format.ratio} · ${plan.format.width}×${plan.format.height} @ ${plan.format.fps}fps |`);
  out.push(`| Duration | ${plan.duration.toFixed(2)}s (${plan.duration.toFixed(1)}s) |`);
  out.push(`| Style | ${tokens.label} (\`${plan.style}\`) |`);
  out.push(`| Scenes | ${plan.scenes.length} |`);
  if (plan.director) {
    out.push(`| Director | ${plan.director.method} · ${plan.director.kind} · ${plan.director.mood} · ${plan.director.act} |`);
    out.push(`| Characters | ${plan.director.characters.length ? plan.director.characters.map((c) => `${c.name} (${c.id})`).join(', ') : 'none detected'} |`);
  }
  out.push(
    `| Captions | ${plan.captions && plan.captions.cues.length > 0 ? `${plan.captions.cues.length} cues (${plan.captions.style.mode})` : 'none'} |`,
  );
  out.push(`| Audio tracks | ${plan.audio.length === 0 ? 'none' : plan.audio.map((a) => `${a.role}:${a.src}`).join(', ')} |`);
  if (meta.providers && meta.providers.length > 0) out.push(`| Providers | ${meta.providers.join(', ')} |`);
  out.push('');

  out.push('## Timeline');
  out.push('');
  const base = plan.scenes
    .filter((s) => s.track !== 'overlay')
    .slice()
    .sort((a, b) => a.start - b.start);
  const overlays = plan.scenes.filter((s) => s.track === 'overlay').slice().sort((a, b) => a.start - b.start);

  base.forEach((scene, i) => {
    out.push(`### SCENE ${String(i + 1).padStart(2, '0')} — ${SCENE_LABEL[scene.type]}`);
    out.push('');
    out.push(`\`${tc(scene.start)} – ${tc(scene.start + scene.duration)}\` · ${scene.duration.toFixed(1)}s${scene.purpose ? ` · *${scene.purpose}*` : ''}`);
    out.push('');
    if (scene.narration) {
      out.push('**Narration**');
      out.push('');
      out.push(`> ${scene.narration.replace(/\n/g, ' ')}`);
      out.push('');
    }
    if (scene.visual) {
      out.push('**Visual**');
      out.push('');
      out.push(scene.visual);
      out.push('');
    }
    if (scene.src) {
      out.push('**Source**');
      out.push('');
      out.push(`\`${scene.src}\``);
      out.push('');
    }
    if (scene.shot) {
      out.push('**Shot**');
      out.push('');
      out.push(scene.shot);
      out.push('');
    }
    const camera = scene.camera ?? 'static';
    out.push('**Camera**');
    out.push('');
    out.push(
      camera === 'static'
        ? 'Locked off.'
        : {
            'push-in': 'Slow cinematic push-in.',
            'pull-out': 'Gradual pull-out revealing the wider frame.',
            'pan-left': 'Lateral pan, left.',
            'pan-right': 'Lateral pan, right.',
            'pan-up': 'Tilt up.',
            'pan-down': 'Tilt down.',
          }[camera] ?? camera,
    );
    out.push('');
    if (scene.environment) out.push(`**Environment**: ${scene.environment}`, '');
    if (scene.lighting) out.push(`**Lighting**: ${scene.lighting}`, '');
    if (scene.characters?.length) out.push(`**Characters**: ${scene.characters.join(', ')}`, '');
    if (scene.motion) out.push(`**Motion**: ${scene.motion}`, '');
    if (scene.audioSync) out.push(`**Audio sync**: ${scene.audioSync}`, '');
    if (scene.emphasis?.length) out.push(`**Emphasis**: ${scene.emphasis.join(', ')}`, '');
    const layers = describeLayers(scene);
    if (layers) {
      out.push('**Layers**');
      out.push('');
      out.push(`Depth stack (far → near): ${layers}`);
      out.push('');
    }
    const fx = describeEffects(scene);
    if (fx) {
      out.push('**Animation / FX**');
      out.push('');
      out.push(fx);
      out.push('');
    }
    if (scene.text && scene.text.length > 0) {
      out.push('**Text**');
      out.push('');
      for (const t of scene.text) out.push(`- *${t.role ?? 'text'}*: ${t.text}`);
      out.push('');
    }
    const tr = scene.transitionIn ?? plan.defaultTransition;
    out.push('**Transition**');
    out.push('');
    out.push(tr && tr.type !== 'none' ? `${tr.type}, ${tr.duration.toFixed(2)}s` : 'Hard cut');
    out.push('');
  });

  if (overlays.length > 0) {
    out.push('## B-roll / overlay track');
    out.push('');
    for (const o of overlays) {
      out.push(
        `- \`${tc(o.start)} – ${tc(o.start + o.duration)}\` · ${SCENE_LABEL[o.type]} · \`${o.src ?? 'procedural'}\`${o.camera ? ` · ${o.camera}` : ''}`,
      );
    }
    out.push('');
  }

  if (plan.overlays && plan.overlays.length > 0) {
    out.push('## Graphic overlays');
    out.push('');
    for (const g of plan.overlays) {
      out.push(`- \`${tc(g.start)} – ${tc(g.start + g.duration)}\` · ${g.kind}${g.title ? ` · **${g.title}**` : ''}${g.subtitle ? ` — ${g.subtitle}` : ''}`);
    }
    out.push('');
  }

  if (plan.audio.length > 0) {
    out.push('## Audio');
    out.push('');
    out.push('| Track | Role | Source | Start | Volume | Ducking |');
    out.push('|---|---|---|---|---|---|');
    for (const a of plan.audio) {
      out.push(
        `| ${a.id} | ${a.role} | \`${a.src}\` | ${tc(a.start)} | ${(a.volume ?? 1).toFixed(2)} | ${a.duck ? 'yes (sidechain)' : '—'} |`,
      );
    }
    out.push('');
  }

  if (plan.captions && plan.captions.cues.length > 0) {
    out.push('## Captions');
    out.push('');
    out.push(`Mode **${plan.captions.style.mode}**, ${plan.captions.cues.length} cues, positioned ${(plan.captions.style.position ?? 0.8) * 100}% from the top.`);
    out.push('');
  }

  if (meta.credits && meta.credits.length > 0) {
    out.push('## Asset credits');
    out.push('');
    for (const c of meta.credits) out.push(`- ${c}`);
    out.push('');
  }

  if (meta.notes && meta.notes.length > 0) {
    out.push('## Production notes');
    out.push('');
    for (const n of meta.notes) out.push(`- ${n}`);
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push('*Generated from `video-plan.json` — regenerate with `video storyboard <project>` after any plan change.*');
  out.push('');
  return out.join('\n');
}
