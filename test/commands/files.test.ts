import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { addFile, removeFile } from '../../src/commands/files.js';
import { saveConfig, loadConfig } from '../../src/config.js';
import type { Deps } from '../../src/context.js';
import { spawnRunner } from '../../src/exec.js';
import { isIgnored } from '../../src/repo.js';
import { FakeSops, FakeVault, MemoryIo } from '../fakes.js';
import { tmpRepoWith } from '../helpers.js';

const deps = (io = new MemoryIo()): Deps => ({
  runner: spawnRunner,
  vault: new FakeVault({ state: 'unauthenticated' }),
  sops: new FakeSops(),
  io,
});

async function setup(files: string[] = []) {
  const root = await tmpRepoWith({ 'backend/.keep': '' });
  await saveConfig(root, { version: 1, repo: 'kys/app', mode: 'vault', files });
  return root;
}

describe('addFile / removeFile', () => {
  test('add from subdirectory normalizes path, ignores it, allows missing file', async () => {
    const root = await setup();
    const cfg = await addFile(deps(), path.join(root, 'backend'), 'application-local.yml');
    expect(cfg.files).toEqual(['backend/application-local.yml']);
    expect((await loadConfig(root)).files).toEqual(['backend/application-local.yml']);
    expect(await isIgnored(spawnRunner, root, 'backend/application-local.yml')).toBe(true);
  });

  test('add is idempotent; add ../ path normalizes relative to cwd', async () => {
    const root = await setup(['.env']);
    const cfg = await addFile(deps(), path.join(root, 'backend'), '../.env');
    expect(cfg.files).toEqual(['.env']);
  });

  test('rejects config.json (UNSUPPORTED_FILE) and outside-repo paths (USAGE)', async () => {
    const root = await setup();
    await expect(addFile(deps(), root, 'config.json')).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    await expect(addFile(deps(), root, '../outside/.env')).rejects.toMatchObject({ code: 'USAGE' });
  });

  test('add warns when file is tracked', async () => {
    const root = await setup();
    await spawnRunner('git', ['add', '-f', 'backend/.keep'], { cwd: root });
    const io = new MemoryIo();
    await addFile(deps(io), root, '.env');
    expect(io.messages.join('\n')).not.toContain('git rm --cached');
    const root2 = await tmpRepoWith({ '.env': 'A=1' });
    await saveConfig(root2, { version: 1, repo: 'kys/app', mode: 'vault', files: [] });
    await spawnRunner('git', ['add', '-f', '.env'], { cwd: root2 });
    const io2 = new MemoryIo();
    await addFile(deps(io2), root2, '.env');
    expect(io2.messages.join('\n')).toContain('git rm --cached');
  });

  test('remove only drops from list and tells the user', async () => {
    const root = await setup(['.env', 'backend/.env']);
    const io = new MemoryIo();
    const cfg = await removeFile(deps(io), path.join(root, 'backend'), '.env');
    expect(cfg.files).toEqual(['.env']);
    expect(io.messages.join('\n')).toContain('Bitwarden');
  });

  test('remove of unlisted file is a no-op with notice', async () => {
    const root = await setup(['.env']);
    const cfg = await removeFile(deps(), root, 'nope/.env');
    expect(cfg.files).toEqual(['.env']);
  });
});
