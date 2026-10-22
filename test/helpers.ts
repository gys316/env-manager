import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnRunner } from '../src/exec.js';

/** Windows 8.3 짧은 경로를 긴 경로로 풀고 path.resolve로 정규화한다. */
export async function realpathNormalized(p: string): Promise<string> {
  return path.resolve(realpathSync.native(p));
}

async function git(cwd: string, args: string[]): Promise<void> {
  const r = await spawnRunner('git', args, { cwd });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

export async function makeTempRepo(opts: { origin?: string } = {}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'envsync-'));
  const root = await realpathNormalized(dir);
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.name', 'envsync-test']);
  await git(root, ['config', 'user.email', 'envsync-test@example.com']);
  if (opts.origin) await git(root, ['remote', 'add', 'origin', opts.origin]);
  return root;
}

export async function writeFiles(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

export async function tmpRepoWith(
  files: Record<string, string | Buffer>,
  opts: { origin?: string } = {},
): Promise<string> {
  const root = await makeTempRepo(opts);
  await writeFiles(root, files);
  return root;
}
