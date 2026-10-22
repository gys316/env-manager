import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { pull } from '../../src/commands/pull.js';
import { push } from '../../src/commands/push.js';
import { FakeVault } from '../fakes.js';
import { makeCtx } from './ctx.js';

const seed = async (files: Record<string, string>) => {
  const vault = new FakeVault({ state: 'unlocked' });
  for (const [p, c] of Object.entries(files)) await vault.upsertNote(`envsync:kys/app:${p}`, c);
  return vault;
};

describe('pull', () => {
  test('creates missing parent directories', async () => {
    const vault = await seed({ 'backend/.env': 'A=1' });
    const b = await makeCtx({ files: ['backend/.env'], local: {}, vault });
    expect((await pull(b.ctx, { force: false }))[0].status).toBe('pulled');
    expect(await readFile(join(b.root, 'backend', '.env'), 'utf8')).toBe('A=1');
  });

  test('skips differing local file and throws PULL_SKIPPED', async () => {
    const vault = await seed({ '.env': 'A=1\nNEW=2' });
    const b = await makeCtx({ files: ['.env'], local: { '.env': 'A=9' }, vault });
    const err = await pull(b.ctx, { force: false }).catch((e) => e);
    expect(err).toMatchObject({ code: 'PULL_SKIPPED' });
    expect(err.details[0]).toMatchObject({ status: 'skipped', added: ['NEW'], changed: ['A'] });
    expect(await readFile(join(b.root, '.env'), 'utf8')).toBe('A=9');
    expect(b.io.messages.join('\n')).not.toContain('=9');
  });

  test('--force backs up then overwrites', async () => {
    const vault = await seed({ '.env': 'A=1' });
    const b = await makeCtx({ files: ['.env'], local: { '.env': 'A=9' }, vault });
    expect((await pull(b.ctx, { force: true }))[0].status).toBe('pulled');
    expect(await readFile(join(b.root, '.env'), 'utf8')).toBe('A=1');
    expect(await readFile(join(b.root, '.env.envsync-backup'), 'utf8')).toBe('A=9');
    expect(await readFile(join(b.root, '.gitignore'), 'utf8')).toContain('*.envsync-backup');
  });

  test('identical local is unchanged and records state', async () => {
    const vault = await seed({ '.env': 'A=1' });
    const b = await makeCtx({ files: ['.env'], local: { '.env': 'A=1' }, vault });
    expect((await pull(b.ctx, { force: false }))[0].status).toBe('unchanged');
    expect(b.ctx.state.get('.env')).toBeDefined();
  });

  test('pull with nothing in vault warns', async () => {
    const b = await makeCtx({ files: ['.env'], local: {} });
    expect((await pull(b.ctx, { force: false }))[0].status).toBe('remote-missing');
    expect(b.io.messages.join('\n')).toContain('Bitwarden에 이 레포의 저장된 파일이 없습니다');
  });

  test('pulled state makes next push unchanged-not-conflict', async () => {
    const vault = await seed({ '.env': 'A=1' });
    const b = await makeCtx({ files: ['.env'], local: {}, vault });
    await pull(b.ctx, { force: false });
    await writeFile(join(b.root, '.env'), 'A=2');
    expect((await push(b.ctx, { yes: true, force: false }))[0].status).toBe('pushed');
  });
});
