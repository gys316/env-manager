import path from 'node:path';
import { VaultBackend } from '../../src/backend.js';
import type { Config } from '../../src/config.js';
import type { Context } from '../../src/context.js';
import { spawnRunner } from '../../src/exec.js';
import { SyncState } from '../../src/state.js';
import { FakeVault, MemoryIo } from '../fakes.js';
import { makeTempRepo, writeFiles } from '../helpers.js';

export async function makeCtx(opts: {
  files: string[];
  local: Record<string, string | Buffer>;
  vault?: FakeVault;
  io?: MemoryIo;
  config?: Partial<Config>;
}): Promise<{ ctx: Context; root: string; vault: FakeVault; io: MemoryIo }> {
  const root = await makeTempRepo();
  await writeFiles(root, opts.local);
  const config: Config = { version: 1, repo: 'kys/app', mode: 'vault', files: opts.files, ...opts.config };
  const vault = opts.vault ?? new FakeVault({ state: 'unlocked' });
  const io = opts.io ?? new MemoryIo();
  const state = await SyncState.load(path.join(root, '.git'));
  const ctx: Context = { root, config, backend: new VaultBackend(vault, config), state, io, runner: spawnRunner };
  return { ctx, root, vault, io };
}
