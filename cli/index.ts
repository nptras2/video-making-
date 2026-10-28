#!/usr/bin/env node
/**
 * `video` — the one command.
 *
 *   video create --in clip.mp4                                  # talking-head edit
 *   video create --in narration.mp3 --prompt "black holes"       # audio → animated story
 *   video create --script script.txt --style 3d-motion           # script → 3D motion graphics
 *   video create --prompt "45s cinematic piece about X"          # prompt → production
 *   video create -i img/                          # a folder of stills + a .txt script
 *
 * Flags mirror the Choose-Your-Mode table in VIDEO_WORKFLOW.md; anything not
 * given is inferred by the input analyzer.
 */
import {parseArgs} from 'node:util';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createVideo, renderExisting, reviseVideo, type PipelineEvent} from '../engine/pipeline';
import {capabilityReport, formatCapabilities} from '../providers/index';
import {PROJECTS_DIR, pathsFor, readPlan, readState, fileExists} from '../engine/project/manager';
import {renderStoryboard} from '../engine/storyboard/index';
import type {Brief} from '../engine/planner/local';
import type {Ratio, VideoPlan} from '../engine/types';

/**
 * Load `.env` / `.env.local` from the project root using Node's built-in
 * loader — no dotenv dependency. Values already in the environment win, so a
 * shell export always overrides a file.
 */
function loadEnvFiles(): void {
  const loader = (process as unknown as {loadEnvFile?: (p?: string) => void}).loadEnvFile;
  if (typeof loader !== 'function') return;
  for (const file of ['.env', '.env.local']) {
    const abs = path.resolve(file);
    try {
      loader.call(process, abs);
    } catch {
      /* file absent — nothing to load */
    }
  }
}

const C = {
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

const log = (...a: unknown[]) => console.log(...a);
const stepLine = (e: PipelineEvent) => {
  const tag =
    e.level === 'error' ? `${C.red}✘${C.reset}` : e.level === 'warn' ? `${C.yellow}!${C.reset}` : `${C.green}✔${C.reset}`;
  log(`  ${tag} ${C.dim}${e.step.padEnd(11)}${C.reset} ${e.message}`);
};

const USAGE = `
${C.bold}video${C.reset} — universal AI video production engine

${C.bold}USAGE${C.reset}
  video create   [inputs…] [options]      produce a video from whatever you have
  video revise   <project> --note "…"     re-plan/re-render with a change
  video render   <project>                re-render the saved plan (fast)
  video storyboard <project>              print the storyboard
  video plan     <project>                print the plan summary
  video list                              list projects
  video doctor                            show available providers/capabilities
  video help

${C.bold}CREATE OPTIONS${C.reset}
  -i, --in <paths…>      input files and/or folders (default: ./input)
      --prompt <text>    what you want, in your own words
      --script <file>    script file (also: any .txt/.md given via --in)
      --audio <file>     narration / voiceover audio
      --video <file>     footage (talking head or B-roll)
      --image <files…>   stills to animate
      --reference <file> style reference (informational; recorded in the project)
      --ratio <r>        16:9 | 9:16 | 1:1 | 4:5        (inferred from prompt)
      --fps <n>          24 | 25 | 30 | 50 | 60          (default 30)
      --duration <sec>   target length
      --style <name>     see STYLES.md                    (inferred)
      --title <text>     title card / project title
      --role <text>      role/organisation for the lower third (e.g. "Video Editor")
      --name <text>      project folder name
      --lang <code>      speech language (e.g. en, hi)
      --voiceover        force narration even if input audio exists
      --no-captions      disable captions
      --no-music         disable the music bed
      --no-render        plan + storyboard only (no render)
      --json             machine-readable summary
  -h, --help
`;

/* ------------------------------- arg plumbing ------------------------------- */

const str = (v: string | undefined): string | undefined => (v && v.length > 0 ? v : undefined);

/** Switches that support the `--no-…` form. */
const NEGATABLE = ['captions', 'music', 'render', 'qc', 'voiceover', 'json'] as const;

/**
 * `parseArgs` has no `--no-x` negation, so `--no-render` and friends are
 * stripped here and applied as explicit `false` values afterwards. Without this
 * the flags documented in --help would simply be rejected.
 */
function splitNegations(argv: string[]): {args: string[]; negated: Record<string, boolean>} {
  const args: string[] = [];
  const negated: Record<string, boolean> = {};
  for (const a of argv) {
    const m = /^--no-([a-z][a-z-]*)$/.exec(a);
    if (m && (NEGATABLE as readonly string[]).includes(m[1])) {
      negated[m[1]] = false;
      continue;
    }
    args.push(a);
  }
  return {args, negated};
}

async function readScriptFiles(paths: string[]): Promise<string[]> {
  const texts: string[] = [];
  for (const p of paths) {
    const ext = path.extname(p).toLowerCase();
    if (!['.txt', '.md', '.srt', '.vtt', '.json', '.csv'].includes(ext)) continue;
    texts.push(await fs.readFile(p, 'utf8'));
  }
  return texts;
}

/** Default input folder: ./input (matches "drop your material here"). */
async function defaultInputs(): Promise<string[]> {
  const dir = path.resolve('input');
  try {
    const entries = await fs.readdir(dir);
    return entries.length > 0 ? [dir] : [];
  } catch {
    return [];
  }
}

const pickInputs = async (values: Record<string, unknown>): Promise<string[]> => {
  const list: string[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && list.push(x));
    else if (typeof v === 'string') list.push(v);
  };
  push(values.in);
  push(values.audio);
  push(values.video);
  push(values.image);
  push(values.reference);
  // a script file is input material too (it is the content to be produced)
  push(values.script);
  push(values.positionals);
  if (list.length > 0) return list;
  return defaultInputs();
};

/* --------------------------------- commands --------------------------------- */

const cmdCreate = async (values: Record<string, unknown>, positionals: string[]): Promise<number> => {
  const all = {...values, positionals};
  const inputs = await pickInputs(all);
  const referencePath = str(values.reference as string | undefined);
  // A reference contributes measured style statistics only. Never let its video
  // accidentally become the primary source clip in the production timeline.
  const productionInputs = referencePath ? inputs.filter((p) => path.resolve(p) !== path.resolve(referencePath)) : inputs;
  const prompt = str(values.prompt as string | undefined);

  if (productionInputs.length === 0 && !prompt) {
    log(`${C.red}Nothing to work with.${C.reset} Pass files via --in / --script, or a --prompt.`);
    log(
      `\nExamples:\n  video create --in input/\n  video create --script script.txt --style 3d-motion\n` +
        `  video create --prompt "45s cinematic video about a man missing his family abroad" --ratio 9:16`,
    );
    return 1;
  }

  const scriptTexts = await readScriptFiles(productionInputs);
  const brief: Brief = {
    prompt,
    title: str(values.title as string | undefined),
    role: str(values.role as string | undefined),
    name: str(values.name as string | undefined),
    duration: values.duration != null ? Number(values.duration) : undefined,
    ratio: str(values.ratio as string | undefined) as Ratio | undefined,
    fps: values.fps != null ? Number(values.fps) : undefined,
    style: str(values.style as string | undefined),          language: str(values.lang as string | undefined),
    referencePath: str(values.reference as string | undefined),
    captions: values.captions === false ? false : undefined,
    music: values.music === false ? false : undefined,
  };
  // --voiceover forces narration synthesis; --no-voiceover disables it entirely.
  brief.voiceover = values.voiceover === true ? true : values.voiceover === false ? false : undefined;

  log(`${C.bold}video create${C.reset} ${C.dim}— ${inputs.length} input(s)${C.reset}`);
  if (prompt) log(`  ${C.dim}brief:${C.reset} ${prompt}`);
  if (scriptTexts.length > 0) log(`  ${C.dim}script:${C.reset} ${scriptTexts.reduce((a, t) => a + t.split(/\s+/).length, 0)} words`);

  try {
    const result = await createVideo({
      name: brief.name,
      inputs: productionInputs,
      brief,
      render: values.render !== false,
      skipQc: values.qc === false,
      onEvent: stepLine,
    });
    logSummary(result, values.json === true);
    return result.qc && result.qc.level === 'fail' ? 2 : 0;
  } catch (e) {
    const err = e as Error & {stderr?: string};
    log(`\n${C.red}Production failed:${C.reset} ${err.message}`);
    if (err.stderr) {
      const tail = String(err.stderr).split('\n').filter(Boolean).slice(-6).join('\n    ');
      log(`  ${C.dim}ffmpeg says:${C.reset}\n    ${tail}`);
    }
    log(`\n${C.dim}Nothing was lost: the project folder and its plan remain on disk for inspection.${C.reset}`);
    return 1;
  }
};

const logSummary = (result: Awaited<ReturnType<typeof createVideo>>, asJson: boolean): void => {
  if (asJson) {
    log(
      JSON.stringify(
        {
          projectId: result.projectId,
          projectDir: result.projectDir,
          durationSec: result.plan.duration,
          format: result.plan.format,
          style: result.plan.style,
          scenes: result.plan.scenes.length,
          usedLlm: result.usedLlm,
          director: result.plan.director,
          qc: result.qc?.level,
          outputs: result.outputs,
          notes: result.notes,
          warnings: result.warnings,
        },
        null,
        2,
      ),
    );
    return;
  }
  log('');
  log(`${C.bold}Done.${C.reset} Project ${C.cyan}${result.projectId}${C.reset}`);
  log(`  ${result.plan.scenes.length} scenes · ${result.plan.duration.toFixed(1)}s · ${result.plan.format.ratio} · ${result.plan.style}`);
  if (result.outputs.final) log(`  ${C.green}video${C.reset}      ${result.outputs.final}`);
  if (result.outputs.thumbnail) log(`  ${C.dim}thumbnail${C.reset}  ${result.outputs.thumbnail}`);
  if (result.outputs.qc) log(`  ${C.dim}qc${C.reset}         ${result.outputs.qc} ${C.dim}(${result.qc?.level})${C.reset}`);
  if (result.plan.director) log(`  ${C.dim}director${C.reset}   ${result.plan.director.method} · ${result.plan.director.kind} · ${result.plan.director.mood} · ${result.plan.director.characters.length} character(s)`);
  log(`  ${C.dim}storyboard${C.reset} ${result.outputs.storyboard}`);
  if (result.outputs.srt) log(`  ${C.dim}captions${C.reset}   ${result.outputs.srt}`);
  const warns = result.warnings.slice(0, 6);
  if (warns.length > 0) {
    log('');
    log(`${C.yellow}Things worth knowing:${C.reset}`);
    for (const w of warns) log(`  · ${w}`);
    if (result.warnings.length > warns.length) log(`  · …and ${result.warnings.length - warns.length} more (see the QC report)`);
  }
};

const cmdDoctor = async (): Promise<number> => {
  log(`${C.bold}Probing capabilities${C.reset} ${C.dim}(first run may install the local whisper.cpp binary)${C.reset}\n`);
  const report = await capabilityReport({deep: true});
  log(formatCapabilities(report));
  log(`\n${C.dim}Optional keys unlock extra capability; nothing below is required to produce a video:${C.reset}`);
  log(`  OPENAI_API_KEY            LLM director + image generation + cloud STT/TTS`);
  log(`  OPENAI_BASE_URL           point the above at any OpenAI-compatible gateway`);
  log(`  ELEVENLABS_API_KEY        premium narration voices`);
  log(`  PEXELS_API_KEY            automatic stock B-roll`);
  log(`  PIXABAY_API_KEY           automatic stock B-roll (extra source)`);
  log(`  UNSPLASH_ACCESS_KEY       stock stills`);
  log(`  JAMENDO_CLIENT_ID         licensed music search`);
  log(`  LUMA_API_KEY / RUNWAY_API_KEY / REPLICATE_API_TOKEN   AI video generation`);
  return 0;
};

const listProjects = async (): Promise<number> => {
  let dirs: string[] = [];
  try {
    dirs = (await fs.readdir(PROJECTS_DIR, {withFileTypes: true})).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    log('No projects yet. Run `video create`.');
    return 0;
  }
  if (dirs.length === 0) {
    log('No projects yet. Run `video create`.');
    return 0;
  }
  log(`${C.bold}${dirs.length} project(s)${C.reset} in ${PROJECTS_DIR}\n`);
  for (const d of dirs.sort()) {
    const paths = pathsFor(path.join(PROJECTS_DIR, d));
    try {
      const state = await readState(paths);
      const hasFinal = await fileExists(paths.final);
      const qcLevel = (await fileExists(paths.qc)) ? (await fs.readFile(paths.qc, 'utf8')).match(/QC report — (\w+)/i)?.[1] ?? '?' : '—';
      log(
        `  ${C.cyan}${d}${C.reset}\n    ${state.name} · ${state.style} · ${state.format.ratio} · ` +
          `${hasFinal ? `${C.green}rendered${C.reset}` : `${C.yellow}planned only${C.reset}`} · QC: ${qcLevel} · ${state.revisions.length} revision(s)`,
      );
    } catch {
      log(`  ${d} ${C.dim}(unreadable)${C.reset}`);
    }
  }
  return 0;
};

const resolveProject = async (arg?: string): Promise<string | null> => {
  if (!arg) return null;
  const asPath = path.resolve(arg);
  if (await fileExists(path.join(asPath, 'PROJECT_STATE.json'))) return asPath;
  const under = path.join(PROJECTS_DIR, arg);
  if (await fileExists(path.join(under, 'PROJECT_STATE.json'))) return under;
  const all = await fs.readdir(PROJECTS_DIR).catch(() => [] as string[]);
  const match = all.find((d) => d.startsWith(arg));
  if (match) return path.join(PROJECTS_DIR, match);
  return null;
};

const cmdStoryboard = async (arg?: string): Promise<number> => {
  const dir = await resolveProject(arg);
  if (!dir) {
    log(`${C.red}Project not found:${C.reset} ${arg}`);
    return 1;
  }
  const paths = pathsFor(dir);
  const plan = await readPlan(paths);
  const state = await readState(paths);
  if (!(await fileExists(paths.storyboard))) {
    const board = renderStoryboard(plan, {projectId: path.basename(dir), format: plan.format, style: plan.style, notes: state.notes});
    await fs.writeFile(paths.storyboard, board, 'utf8');
  }
  log(await fs.readFile(paths.storyboard, 'utf8'));
  return 0;
};

const cmdPlan = async (arg?: string): Promise<number> => {
  const dir = await resolveProject(arg);
  if (!dir) {
    log(`${C.red}Project not found:${C.reset} ${arg}`);
    return 1;
  }
  const plan = await readPlan(pathsFor(dir));
  log(`${C.bold}${plan.title}${C.reset}`);
  log(`  ${plan.scenes.length} scenes · ${plan.duration.toFixed(1)}s · ${plan.format.width}×${plan.format.height}@${plan.format.fps} · ${plan.style}`);
  log('');
  for (const s of plan.scenes.slice().sort((a, b) => a.start - b.start)) {
    const t = `${s.start.toFixed(1)}–${(s.start + s.duration).toFixed(1)}s`.padEnd(14);
    log(`  ${C.dim}${t}${C.reset} ${s.type.padEnd(9)} ${s.track === 'overlay' ? `${C.dim}[overlay]${C.reset} ` : ''}${s.src ?? s.visual ?? ''}`);
  }
  if (plan.audio.length > 0) {
    log('');
    for (const a of plan.audio) log(`  ${C.dim}audio${C.reset} ${a.role.padEnd(10)} ${a.src} @${a.start}s vol=${(a.volume ?? 1).toFixed(2)}${a.duck ? ' (ducked)' : ''}`);
  }
  return 0;
};

const cmdRender = async (arg?: string, scale?: number): Promise<number> => {
  const dir = await resolveProject(arg);
  if (!dir) {
    log(`${C.red}Project not found:${C.reset} ${arg}`);
    return 1;
  }
  const res = await renderExisting(dir, {scale, onEvent: stepLine});
  log(`\n${C.green}Rendered${C.reset} ${res.final}${res.qc ? ` · QC ${res.qc.level}` : ''}`);
  return 0;
};

const cmdRevise = async (arg: string | undefined, values: Record<string, unknown>): Promise<number> => {
  const dir = await resolveProject(arg);
  if (!dir) {
    log(`${C.red}Project not found:${C.reset} ${arg}`);
    return 1;
  }
  const note = str(values.note as string | undefined);
  if (!note) {
    log(`${C.red}--note is required${C.reset} — say what should change (recorded as a revision).`);
    return 1;
  }
  const patch: Brief = {};
  if (values.ratio) patch.ratio = values.ratio as Ratio;
  if (values.fps != null) patch.fps = Number(values.fps);
  if (values.style) patch.style = String(values.style);
  if (values.captions === false) patch.captions = false;
  if (values.music === false) patch.music = false;
  log(`${C.bold}video revise${C.reset} ${C.cyan}${path.basename(dir)}${C.reset} — ${note}`);
  const result = await reviseVideo({
    project: dir,
    note,
    briefPatch: patch,
    render: values.render !== false,
    onEvent: stepLine,
  });
  logSummary(result, false);
  return 0;
};

/* ---------------------------------- main ---------------------------------- */

const main = async (): Promise<number> => {
  loadEnvFiles();
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';

  try {
    if (command === 'create' || command === 'make' || command === 'run') {
      const {args, negated} = splitNegations(argv.slice(1));
      const {values, positionals} = parseArgs({
        args,
        allowPositionals: true,
        options: {
          in: {type: 'string', multiple: true, short: 'i'},
          prompt: {type: 'string'},
          script: {type: 'string'},
          audio: {type: 'string'},
          video: {type: 'string'},
          image: {type: 'string', multiple: true},
          reference: {type: 'string'},
          ratio: {type: 'string'},
          fps: {type: 'string'},
          duration: {type: 'string'},
          style: {type: 'string'},
          title: {type: 'string'},
          role: {type: 'string'},
          name: {type: 'string'},
          lang: {type: 'string'},
          voiceover: {type: 'boolean'},
          captions: {type: 'boolean'},
          music: {type: 'boolean'},
          render: {type: 'boolean'},
          qc: {type: 'boolean'},
          json: {type: 'boolean'},
          help: {type: 'boolean', short: 'h'},
        },
      });
      if (values.help) {
        log(USAGE);
        return 0;
      }
      return await cmdCreate({...values, ...negated} as Record<string, unknown>, positionals);
    }

    switch (command) {
      case 'doctor':
        return await cmdDoctor();
      case 'list':
      case 'ls':
        return await listProjects();
      case 'storyboard':
        return await cmdStoryboard(argv[1]);
      case 'plan':
        return await cmdPlan(argv[1]);
      case 'render': {
        const {values, positionals} = parseArgs({
          args: argv.slice(1),
          allowPositionals: true,
          options: {scale: {type: 'string'}, quality: {type: 'string'}},
        });
        const scale = values.scale ? Number(values.scale) : values.quality === 'draft' ? 0.5 : 1;
        return await cmdRender(positionals[0], scale);
      }
      case 'revise': {
        const {args, negated} = splitNegations(argv.slice(1));
        const {values, positionals} = parseArgs({
          args,
          allowPositionals: true,
          options: {
            note: {type: 'string'},
            ratio: {type: 'string'},
            fps: {type: 'string'},
            style: {type: 'string'},
            captions: {type: 'boolean'},
            music: {type: 'boolean'},
            render: {type: 'boolean'},
          },
        });
        return await cmdRevise(positionals[0], {...values, ...negated} as Record<string, unknown>);
      }
      case 'help':
      default:
        log(USAGE);
        return command === 'help' ? 0 : 1;
    }
  } catch (e) {
    const err = e as Error;
    log(`${C.red}error:${C.reset} ${err.message}`);
    if (process.env.VIDEO_DEBUG) log(err.stack);
    return 1;
  }
};

main().then((code) => process.exit(code));
