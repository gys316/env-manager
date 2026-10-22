import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { spawnRunner } from '../src/exec.js';
import { makeTempRepo } from './helpers.js';

const cliPath = path.resolve('dist', 'cli.js');

beforeAll(() => {
  execSync('npm run build', { stdio: 'pipe' });
}, 120000);

const run = (args: string[], cwd: string) => spawnRunner(process.execPath, [cliPath, ...args], { cwd });

describe('cli', () => {
  test('dist/cli.js starts with a shebang', async () => {
    expect((await readFile(cliPath, 'utf8')).startsWith('#!/usr/bin/env node')).toBe(true);
  });

  test('status outside a git repo -> exit 2 with JSON error', async () => {
    const r = await run(['status', '--json'], await mkdtemp(path.join(tmpdir(), 'n')));
    expect(r.code).toBe(2);
    const lines = r.stdout.toString().trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ ok: false, command: 'status', error: { code: 'NOT_GIT_REPO' } });
  });

  test('push without init -> NOT_INITIALIZED, exit 2', async () => {
    const root = await makeTempRepo({ origin: 'git@github.com:o/r.git' });
    const r = await run(['push', '--yes', '--json'], root);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout.toString())).toMatchObject({ ok: false, error: { code: 'NOT_INITIALIZED' } });
    expect(r.stderr).not.toBe('');
  });

  test('init --yes --json in a repo creates config', async () => {
    const root = await makeTempRepo({ origin: 'git@github.com:o/r.git' });
    const r = await run(['init', '--yes', '--json'], root);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout.toString())).toMatchObject({ ok: true, command: 'init', warnings: [] });
    expect(existsSync(path.join(root, '.envsync.config'))).toBe(true);
  });

  test('global options work after the subcommand and text mode keeps stdout empty', async () => {
    const root = await makeTempRepo();
    const r = await run(['init', '--repo', 'o/r', '--yes'], root);
    expect(r.code).toBe(0);
    expect(r.stdout.toString()).toBe('');
    const again = await run(['init', '--repo', 'o/r', '--yes'], root);
    expect(again.code).toBe(2);
    expect(again.stderr).toContain('envsync status');
  });

  test('add and remove update the config', async () => {
    const root = await makeTempRepo({ origin: 'git@github.com:o/r.git' });
    await run(['init', '--yes'], root);
    const add = await run(['add', '.env.local', '--json'], root);
    expect(add.code).toBe(0);
    expect(JSON.parse(await readFile(path.join(root, '.envsync.config'), 'utf8')).files).toContain('.env.local');
    const rm = await run(['remove', '.env.local', '--json'], root);
    expect(rm.code).toBe(0);
    expect(JSON.parse(await readFile(path.join(root, '.envsync.config'), 'utf8')).files).not.toContain('.env.local');
  });

  test('--help lists all commands', async () => {
    const r = await run(['--help'], process.cwd());
    expect(r.code).toBe(0);
    const out = r.stdout.toString();
    for (const c of ['init', 'push', 'pull', 'status', 'add', 'remove']) expect(out).toContain(c);
  });

  test('--version prints package version', async () => {
    const r = await run(['--version'], process.cwd());
    expect(r.code).toBe(0);
    expect(r.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('unknown command -> exit 2', async () => {
    const r = await run(['bogus'], process.cwd());
    expect(r.code).toBe(2);
  });
});
