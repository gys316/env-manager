import { readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { EnvsyncError } from './errors.js';
import type { Runner } from './exec.js';

// Windows에서는 짧은 8.3 경로와 git이 돌려주는 긴 경로가 다를 수 있어 realpath로 맞춘다.
function normalize(p: string): string {
  const resolved = path.resolve(p);
  try {
    return path.resolve(realpathSync.native(resolved));
  } catch {
    return resolved;
  }
}

async function gitOut(runner: Runner, cwd: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  const r = await runner('git', args, { cwd });
  return { code: r.code, out: r.stdout.toString('utf8').trim(), err: r.stderr };
}

export async function findRepoRoot(runner: Runner, cwd: string): Promise<string> {
  const r = await gitOut(runner, cwd, ['rev-parse', '--show-toplevel']);
  if (r.code !== 0 || r.out === '') {
    throw new EnvsyncError('NOT_GIT_REPO', 'git 레포지토리 안에서 실행해야 합니다.', 'git 레포의 폴더에서 다시 실행하세요.');
  }
  return normalize(r.out);
}

export async function gitDir(runner: Runner, root: string): Promise<string> {
  const r = await gitOut(runner, root, ['rev-parse', '--absolute-git-dir']);
  if (r.code !== 0 || r.out === '') {
    throw new EnvsyncError('NOT_GIT_REPO', 'git 디렉터리를 찾을 수 없습니다.');
  }
  return normalize(r.out);
}

export async function originUrl(runner: Runner, root: string): Promise<string | null> {
  const r = await gitOut(runner, root, ['remote', 'get-url', 'origin']);
  return r.code === 0 && r.out !== '' ? r.out : null;
}

export function parseRemote(url: string): string | null {
  const u = url.trim();
  if (u === '' || /\s/.test(u)) return null;
  let rest: string | undefined;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i.exec(u);
  if (scheme) rest = scheme[1];
  else {
    const scp = /^(?:[^@/:]+@)?[^@/:]+:(?!\/)(.+)$/.exec(u);
    if (scp) rest = scp[1];
  }
  if (rest === undefined) return null;
  const cleaned = rest.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
  return cleaned === '' ? null : cleaned;
}

export async function isIgnored(runner: Runner, root: string, relPath: string): Promise<boolean> {
  const r = await runner('git', ['check-ignore', '-q', '--', relPath], { cwd: root });
  return r.code === 0;
}

export async function isTracked(runner: Runner, root: string, relPath: string): Promise<boolean> {
  const r = await runner('git', ['ls-files', '--error-unmatch', '--', relPath], { cwd: root });
  return r.code === 0;
}

async function readIfExists(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw e;
  }
}

async function appendLines(file: string, header: string | null, lines: string[]): Promise<void> {
  const existing = await readIfExists(file);
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  let text = existing;
  if (text !== '' && !text.endsWith('\n')) text += eol;
  if (header && !text.split(/\r?\n/).includes(header)) text += header + eol;
  text += lines.join(eol) + eol;
  await writeFile(file, text);
}

export async function ensureIgnored(runner: Runner, root: string, patterns: string[]): Promise<string[]> {
  const gitignore = path.join(root, '.gitignore');
  const existingLines = (await readIfExists(gitignore)).split(/\r?\n/).map((l) => l.trim());
  const added: string[] = [];
  for (const raw of patterns) {
    const isGlob = /[*?[]/.test(raw);
    if (isGlob) {
      if (existingLines.includes(raw) || added.includes(raw)) continue;
      added.push(raw);
      continue;
    }
    const rel = raw.replace(/^\/+/, '');
    if (await isIgnored(runner, root, rel)) continue;
    const pattern = '/' + rel;
    if (!added.includes(pattern)) added.push(pattern);
  }
  if (added.length > 0) await appendLines(gitignore, '# envsync', added);
  return added;
}

export async function ensureGitattributes(root: string, line: string): Promise<void> {
  const file = path.join(root, '.gitattributes');
  const existing = await readIfExists(file);
  if (existing.split(/\r?\n/).some((l) => l.trim() === line)) return;
  await appendLines(file, null, [line]);
}
