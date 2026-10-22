import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { diffFields, localPath, summaryLine } from '../context.js';
import type { Context, FileResult } from '../context.js';
import { diffKeys } from '../diff.js';
import { fileFormat } from '../detect.js';
import { EnvsyncError } from '../errors.js';
import { BACKUP_PATTERN, ensureIgnored } from '../repo.js';
import { sha256 } from '../state.js';

export type { FileResult, FileStatus } from '../context.js';

/** 평문 파일은 소유자만 읽도록 만든다(Windows에서는 효과 없음). */
const PLAIN_MODE = 0o600;

async function readIfExists(abs: string): Promise<Buffer | null> {
  try {
    return await readFile(abs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * `<파일>.envsync-backup`에 백업한다. 이미 다른 내용의 백업이 있으면 지우지 않고
 * `<파일>.envsync-backup-<YYYYMMDDHHmmss>`에 쓴다. 쓴 경로(레포 상대)를 돌려준다.
 */
async function writeBackup(abs: string, rel: string, content: Buffer, now: Date): Promise<{ rel: string; renamed: boolean }> {
  const base = `${abs}.envsync-backup`;
  const existing = await readIfExists(base);
  if (existing === null || existing.equals(content)) {
    await writeFile(base, content, { mode: PLAIN_MODE });
    return { rel: `${rel}.envsync-backup`, renamed: false };
  }
  const stamp = timestamp(now);
  for (let i = 0; ; i++) {
    const suffix = i === 0 ? stamp : `${stamp}-${i}`;
    try {
      await writeFile(`${base}-${suffix}`, content, { mode: PLAIN_MODE, flag: 'wx' });
      return { rel: `${rel}.envsync-backup-${suffix}`, renamed: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
}

export async function pull(ctx: Context, opts: { force: boolean; now?: Date }): Promise<FileResult[]> {
  const { config, backend, state, io } = ctx;
  const results: FileResult[] = [];

  /** 평문을 쓰기 전에 레포 .gitignore가 이 파일을 덮는지 확인하고, 아니면 추가한다. */
  const ensurePlainIgnored = async (p: string) => {
    const added = await ensureIgnored(ctx.runner, ctx.root, [p]);
    if (added.length > 0) {
      io.warn(`${p}이(가) .gitignore에 없어 추가했습니다. 평문 파일이 커밋되지 않도록 .gitignore 변경을 커밋하세요.`);
    }
  };

  try {
    for (const p of config.files) {
      const abs = localPath(ctx.root, p);
      const remote = await backend.read(p);
      if (!remote) {
        results.push({ path: p, status: 'remote-missing' });
        continue;
      }
      const warning = remote.warning ? { warning: remote.warning } : {};
      const local = await readIfExists(abs);
      const record = () => state.set(p, { hash: sha256(remote.content), remoteVersion: remote.version });

      if (local === null) {
        await ensurePlainIgnored(p);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, remote.content, { mode: PLAIN_MODE });
        record();
        results.push({ path: p, status: 'pulled', ...warning });
        continue;
      }
      if (local.equals(remote.content)) {
        record();
        results.push({ path: p, status: 'unchanged', ...warning });
        continue;
      }

      const format = fileFormat(p);
      const opaque = config.formats?.[p] === 'binary' || format === null;
      const diff = opaque ? { opaque: true as const } : diffFields(diffKeys(local, remote.content, format));
      // fast-forward: 마지막 동기화 이후 로컬을 고치지 않았으면 --force 없이, 백업 없이 원격으로 갱신한다.
      const last = state.get(p);
      if (last !== undefined && sha256(local) === last.hash) {
        await ensurePlainIgnored(p);
        await writeFile(abs, remote.content, { mode: PLAIN_MODE });
        record();
        results.push({ path: p, status: 'pulled', ...diff, ...warning });
        continue;
      }
      if (!opts.force) {
        results.push({ path: p, status: 'skipped', ...diff, ...warning });
        continue;
      }
      // 백업을 쓰기 전에 무시 규칙부터 넣는다.
      await ensureIgnored(ctx.runner, ctx.root, [BACKUP_PATTERN]);
      await ensurePlainIgnored(p);
      const backup = await writeBackup(abs, p, local, opts.now ?? new Date());
      if (backup.renamed) {
        io.warn(`${p}: 이전 백업(${p}.envsync-backup)과 내용이 달라 ${backup.rel}에 새로 백업했습니다.`);
      }
      await writeFile(abs, remote.content, { mode: PLAIN_MODE });
      record();
      results.push({ path: p, status: 'pulled', ...diff, ...warning });
    }
  } finally {
    await state.save();
  }

  for (const r of results) if (r.warning) io.warn(r.warning);

  if (results.length > 0 && results.every((r) => r.status === 'remote-missing')) {
    io.warn('Bitwarden에 이 레포의 저장된 파일이 없습니다');
  }

  const skipped = results.filter((r) => r.status === 'skipped');
  if (skipped.length > 0) {
    for (const s of skipped) io.info(summaryLine(s));
    throw new EnvsyncError(
      'PULL_SKIPPED',
      `마지막 동기화 이후 로컬에서 고쳤거나 동기화 기록이 없어 건너뛴 파일이 있습니다: ${skipped.map((s) => s.path).join(', ')}`,
      '--force로 덮어쓸 수 있습니다. 기존 파일은 <파일>.envsync-backup으로 백업됩니다.',
      results,
    );
  }
  return results;
}
