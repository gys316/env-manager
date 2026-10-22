import { readFile } from 'node:fs/promises';
import { diffFields, localPath, summaryLine } from '../context.js';
import type { Context, FileResult } from '../context.js';
import { diffKeys } from '../diff.js';
import { fileFormat } from '../detect.js';
import { EnvsyncError } from '../errors.js';
import { sha256 } from '../state.js';

export type { FileResult, FileStatus } from '../context.js';

async function readLocal(abs: string): Promise<Buffer | null> {
  try {
    return await readFile(abs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export async function push(ctx: Context, opts: { yes: boolean; force: boolean }): Promise<FileResult[]> {
  const { config, backend, state, io } = ctx;
  const results: FileResult[] = [];
  const locals = new Map<string, Buffer>();
  const candidates: FileResult[] = [];

  for (const path of config.files) {
    const local = await readLocal(localPath(ctx.root, path));
    if (!local) {
      results.push({ path, status: 'local-missing' });
      continue;
    }
    const remote = await backend.read(path);
    const rec = state.get(path);
    if (remote && !opts.force) {
      if (rec && remote.version !== rec.remoteVersion) {
        results.push({ path, status: 'conflict' });
        continue;
      }
      if (!rec && !remote.content.equals(local)) {
        results.push({ path, status: 'conflict' });
        continue;
      }
    }
    if (remote && remote.content.equals(local)) {
      state.set(path, { hash: sha256(local), remoteVersion: remote.version });
      results.push({ path, status: 'unchanged' });
      continue;
    }
    const format = fileFormat(path);
    const opaque = config.formats?.[path] === 'binary' || format === null;
    const diff = opaque
      ? { opaque: true as const }
      : diffFields(diffKeys(remote?.content ?? null, local, format));
    const r: FileResult = { path, status: 'pushed', ...diff };
    locals.set(path, local);
    candidates.push(r);
    results.push(r);
  }

  const conflicts = results.filter((r) => r.status === 'conflict');
  if (conflicts.length > 0) {
    throw new EnvsyncError(
      'CONFLICT',
      `원격이 마지막 동기화 이후 바뀌었거나 내용이 달라 push하지 않았습니다: ${conflicts.map((c) => c.path).join(', ')}`,
      'envsync pull 후 다시 push하거나, 덮어쓰려면 --force를 사용하세요.',
      results,
    );
  }

  if (candidates.length > 0) {
    for (const c of candidates) io.info(summaryLine(c));
    if (!opts.yes) {
      if (!io.interactive) {
        throw new EnvsyncError('CONFIRMATION_REQUIRED', '확인이 필요한 작업입니다.', '--yes 옵션을 붙여 다시 실행하세요.');
      }
      if (!(await io.confirm('위 변경을 반영할까요?'))) {
        for (const c of candidates) c.status = 'skipped';
        await state.save();
        return results;
      }
    }
  }

  try {
    for (const c of candidates) {
      const local = locals.get(c.path) as Buffer;
      const w = await backend.write(c.path, local);
      c.status = 'pushed';
      if (w.warning) c.warning = w.warning;
      state.set(c.path, { hash: sha256(local), remoteVersion: w.version });
    }
  } finally {
    await state.save();
  }

  for (const r of results) if (r.warning) io.warn(r.warning);
  if (config.mode === 'sops' && candidates.length > 0) io.info('.enc 파일을 git에 커밋하세요');
  return results;
}
