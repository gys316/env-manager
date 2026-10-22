import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { SopsBackend, VaultBackend } from '../src/backend.js';
import { saveConfig } from '../src/config.js';
import { createContext, type Deps } from '../src/context.js';
import { spawnRunner } from '../src/exec.js';
import { FakeSops, FakeVault, MemoryIo } from './fakes.js';
import { tmpRepoWith } from './helpers.js';

const deps = (o: Partial<Deps> = {}): Deps => ({
  runner: spawnRunner,
  vault: new FakeVault({ state: 'unlocked' }),
  sops: new FakeSops(),
  io: new MemoryIo(),
  ...o,
});

describe('createContext', () => {
  test('from subdirectory resolves root', async () => {
    const root = await tmpRepoWith({ 'backend/x': '' });
    await saveConfig(root, { version: 1, repo: 'kys/app', mode: 'vault', files: ['.env'] });
    const ctx = await createContext(deps(), path.join(root, 'backend'), { sync: false });
    expect(ctx.root).toBe(root);
    expect(ctx.config.repo).toBe('kys/app');
    expect(ctx.backend).toBeInstanceOf(VaultBackend);
  });

  test('locked non-interactive -> VAULT_LOCKED', async () => {
    const root = await tmpRepoWith({});
    await saveConfig(root, { version: 1, repo: 'kys/app', mode: 'vault', files: [] });
    const d = deps({ vault: new FakeVault({ state: 'locked' }), io: new MemoryIo({ interactive: false }) });
    await expect(createContext(d, root, { sync: false })).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
  });

  test('config errors surface before any vault call', async () => {
    const root = await tmpRepoWith({});
    const vault = new FakeVault();
    vault.status = async () => {
      throw new Error('vault touched');
    };
    await expect(createContext(deps({ vault }), root, { sync: true })).rejects.toMatchObject({ code: 'NOT_INITIALIZED' });
  });

  test('sync calls vault.sync; sops mode checks version and uses SopsBackend', async () => {
    const root = await tmpRepoWith({});
    await saveConfig(root, { version: 1, repo: 'kys/app', mode: 'sops', files: [], sops: { recipient: 'age1x' } });
    const vault = new FakeVault();
    const calls: string[] = [];
    vault.sync = async () => void calls.push('sync');
    const sops = new FakeSops();
    sops.checkVersion = async () => void calls.push('version');
    const ctx = await createContext(deps({ vault, sops }), root, { sync: true });
    expect(calls).toEqual(['sync', 'version']);
    expect(ctx.backend).toBeInstanceOf(SopsBackend);
  });
});
