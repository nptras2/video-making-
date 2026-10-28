#!/usr/bin/env node
/**
 * Launcher for the `video` command.
 *
 * The CLI is TypeScript; this shim runs it through the project's own tsx so
 * `npm link` (or `npx video`) gives a real `video create …` command on every
 * platform without a build step.
 */
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const entry = path.join(root, 'cli', 'index.ts');

const tsxCli = [
  path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  path.join(root, 'node_modules', 'tsx', 'dist', 'cli.cjs'),
].find((p) => fs.existsSync(p));

if (!tsxCli) {
  console.error('tsx is not installed. Run `npm install` in ' + root + ' first.');
  process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
