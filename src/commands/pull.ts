import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { diffFields, localPath, summaryLine } from '../context.js';
import type { Context, FileResult } from '../context.js';
import { diffKeys } from '../diff.js';
import { fileFormat } from '../detect.js';
import { EnvsyncError } from '../errors.js';
import { ensureIgnored } from '../repo.js';
import { sha256 } from '../state.js';

export type { FileResult, FileStatus } from '../context.js';

export async function pull(ctx: Context, opts: { force: boolean }): Promise<FileResult[]> {
  const { config, backend, state, io } = ctx;
  const results: FileResult[] = [];

  try {
    for (const p of config.files) {
      const abs = localPath(ctx.root, p);
      const remote = await backend.read(p);
      if (!remote) {
        results.push({ path: p, status: 'remote-missing' });
        continue;
      }
      let local: Buffer | null = null;
      try {
        local = await readFile(abs);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      const record = () => state.set(p, { hash: sha256(remote.content), remoteVersion: remote.version });

      if (local === null) {
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, remote.content);
        record();
        results.push({ path: p, status: 'pulled' });
        continue;
      }
      if (local.equals(remote.content)) {
        record();
        results.push({ path: p, status: 'unchanged' });
        continue;
      }

      const format = fileFormat(p);
      const opaque = config.formats?.[p] === 'binary' || format === null;
      const diff = opaque ? { opaque: true as const } : diffFields(diffKeys(local, remote.content, format));
      if (!opts.force) {
        results.push({ path: p, status: 'skipped', ...diff });
        continue;
      }
      await writeFile(`${abs}.envsync-backup`, local);
      await ensureIgnored(ctx.runner, ctx.root, ['*.envsync-backup']);
      await writeFile(abs, remote.content);
      record();
      results.push({ path: p, status: 'pulled', ...diff });
    }
  } finally {
    await state.save();
  }

  if (results.length > 0 && results.every((r) => r.status === 'remote-missing')) {
    io.warn('Bitwarden에 이 레포의 저장된 파일이 없습니다');
  }

  const skipped = results.filter((r) => r.status === 'skipped');
  if (skipped.length > 0) {
    for (const s of skipped) io.info(summaryLine(s));
    throw new EnvsyncError(
      'PULL_SKIPPED',
      `로컬 내용이 달라 건너뛴 파일이 있습니다: ${skipped.map((s) => s.path).join(', ')}`,
      '--force로 덮어쓸 수 있습니다. 기존 파일은 <파일>.envsync-backup으로 백업됩니다.',
      results,
    );
  }
  return results;
}
