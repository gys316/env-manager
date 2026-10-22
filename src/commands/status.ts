import { readFile } from 'node:fs/promises';
import { localPath } from '../context.js';
import type { Context, FileResult } from '../context.js';
import { sha256 } from '../state.js';

export type { FileResult, FileStatus } from '../context.js';

export async function status(ctx: Context): Promise<FileResult[]> {
  const { config, backend, state } = ctx;
  const results: FileResult[] = [];
  for (const path of config.files) {
    let local: Buffer | null = null;
    try {
      local = await readFile(localPath(ctx.root, path));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const version = await backend.version(path);
    if (!local && version === null) results.push({ path, status: 'missing' });
    else if (local && version === null) results.push({ path, status: 'local-only' });
    else if (!local) results.push({ path, status: 'remote-only' });
    else {
      const rec = state.get(path);
      if (rec) {
        const localChanged = sha256(local) !== rec.hash;
        const remoteChanged = version !== rec.remoteVersion;
        results.push({
          path,
          status: localChanged && remoteChanged ? 'conflict' : localChanged ? 'local-changed' : remoteChanged ? 'remote-changed' : 'synced',
        });
      } else {
        const remote = await backend.read(path);
        results.push({ path, status: remote && remote.content.equals(local) ? 'synced' : 'differs' });
      }
    }
  }
  return results;
}
