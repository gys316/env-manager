import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { pull } from '../../src/commands/pull.js';
import { push } from '../../src/commands/push.js';
import { SopsBackend } from '../../src/backend.js';
import { spawnRunner } from '../../src/exec.js';
import { isIgnored } from '../../src/repo.js';
import { FakeSops, FakeVault } from '../fakes.js';
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

describe('pull fast-forward', () => {
  const backups = async (root: string) => (await readdir(root)).filter((f) => f.includes('envsync-backup'));

  test('local unchanged since last sync -> overwritten without --force and without backup', async () => {
    const vault = new FakeVault({ state: 'unlocked' });
    const a = await makeCtx({ files: ['.env'], local: { '.env': 'A=1\n' }, vault });
    await push(a.ctx, { yes: true, force: false });
    const pcB = await makeCtx({ files: ['.env'], local: {}, vault });
    expect((await pull(pcB.ctx, { force: false }))[0].status).toBe('pulled');

    await writeFile(join(a.root, '.env'), 'A=2\nNEW=3\n');
    expect((await push(a.ctx, { yes: true, force: false }))[0].status).toBe('pushed');

    const r = await pull(pcB.ctx, { force: false });
    expect(r[0]).toMatchObject({ status: 'pulled', added: ['NEW'], changed: ['A'] });
    expect(await readFile(join(pcB.root, '.env'), 'utf8')).toBe('A=2\nNEW=3\n');
    expect(await backups(pcB.root)).toEqual([]);
    expect(pcB.io.messages.join('\n')).not.toContain('=3');
    // 다음 pull/push 기준도 갱신된다.
    expect((await pull(pcB.ctx, { force: false }))[0].status).toBe('unchanged');
  });

  test('local edited since last sync -> still skipped with PULL_SKIPPED', async () => {
    const vault = new FakeVault({ state: 'unlocked' });
    const a = await makeCtx({ files: ['.env'], local: { '.env': 'A=1\n' }, vault });
    await push(a.ctx, { yes: true, force: false });
    const pcB = await makeCtx({ files: ['.env'], local: {}, vault });
    await pull(pcB.ctx, { force: false });

    await writeFile(join(a.root, '.env'), 'A=2\n');
    await push(a.ctx, { yes: true, force: false });
    await writeFile(join(pcB.root, '.env'), 'A=1\nLOCAL=1\n');

    const err = await pull(pcB.ctx, { force: false }).catch((e) => e);
    expect(err).toMatchObject({ code: 'PULL_SKIPPED' });
    expect(err.details[0]).toMatchObject({ status: 'skipped' });
    expect(await readFile(join(pcB.root, '.env'), 'utf8')).toBe('A=1\nLOCAL=1\n');
    expect(await backups(pcB.root)).toEqual([]);
  });

  test('no state record and content differs -> skipped', async () => {
    const vault = await seed({ '.env': 'A=1\n' });
    const b = await makeCtx({ files: ['.env'], local: { '.env': 'A=9\n' }, vault });
    expect(b.ctx.state.get('.env')).toBeUndefined();
    const err = await pull(b.ctx, { force: false }).catch((e) => e);
    expect(err).toMatchObject({ code: 'PULL_SKIPPED' });
    expect(await readFile(join(b.root, '.env'), 'utf8')).toBe('A=9\n');
  });

  test('fast-forward still makes sure the plaintext is git-ignored', async () => {
    const vault = await seed({ 'backend/.env': 'A=1' });
    const b = await makeCtx({ files: ['backend/.env'], local: {}, vault });
    await pull(b.ctx, { force: false });
    await writeFile(join(b.root, '.gitignore'), '');
    await vault.upsertNote('envsync:kys/app:backend/.env', 'A=2');
    expect((await pull(b.ctx, { force: false }))[0].status).toBe('pulled');
    expect(await isIgnored(spawnRunner, b.root, 'backend/.env')).toBe(true);
  });
});

describe('pull safety', () => {
  test('restored plaintext not covered by .gitignore gets added and warned', async () => {
    const vault = await seed({ 'backend/.env': 'A=1' });
    const b = await makeCtx({ files: ['backend/.env'], local: {}, vault });
    await pull(b.ctx, { force: false });
    expect(await isIgnored(spawnRunner, b.root, 'backend/.env')).toBe(true);
    expect(await readFile(join(b.root, '.gitignore'), 'utf8')).toContain('/backend/.env');
    expect(b.io.messages.join('\n')).toContain('.gitignore');
  });

  test('already ignored file: .gitignore untouched, no warning', async () => {
    const vault = await seed({ '.env': 'A=1' });
    const b = await makeCtx({ files: ['.env'], local: { '.gitignore': '.env\n' }, vault });
    await pull(b.ctx, { force: false });
    expect(await readFile(join(b.root, '.gitignore'), 'utf8')).toBe('.env\n');
    expect(b.io.messages.join('\n')).not.toContain('.gitignore');
  });

  test('--force keeps a differing existing backup and writes a timestamped one', async () => {
    const vault = await seed({ '.env': 'A=1' });
    const b = await makeCtx({ files: ['.env'], local: { '.env': 'A=9', '.env.envsync-backup': 'A=old' }, vault });
    const now = new Date(2026, 9, 22, 7, 5, 3);
    await pull(b.ctx, { force: true, now });
    expect(await readFile(join(b.root, '.env.envsync-backup'), 'utf8')).toBe('A=old');
    expect(await readFile(join(b.root, '.env.envsync-backup-20261022070503'), 'utf8')).toBe('A=9');
    expect(await readFile(join(b.root, '.env'), 'utf8')).toBe('A=1');
    expect(await readFile(join(b.root, '.gitignore'), 'utf8')).toContain('*.envsync-backup*');
    expect(await isIgnored(spawnRunner, b.root, '.env.envsync-backup-20261022070503')).toBe(true);
    expect(b.io.messages.join('\n')).toContain('.env.envsync-backup-20261022070503');
  });

  test('--force with an identical existing backup reuses it', async () => {
    const vault = await seed({ '.env': 'A=1' });
    const b = await makeCtx({ files: ['.env'], local: { '.env': 'A=9', '.env.envsync-backup': 'A=9' }, vault });
    await pull(b.ctx, { force: true });
    expect(await readFile(join(b.root, '.env.envsync-backup'), 'utf8')).toBe('A=9');
    expect((await readdir(b.root)).filter((f) => f.startsWith('.env.envsync-backup-'))).toEqual([]);
  });

  test.skipIf(process.platform === 'win32')('restored plaintext is written with mode 0600', async () => {
    const vault = await seed({ '.env': 'A=1' });
    const b = await makeCtx({ files: ['.env'], local: {}, vault });
    await pull(b.ctx, { force: false });
    expect((await stat(join(b.root, '.env'))).mode & 0o777).toBe(0o600);
  });

  test('sops: .enc in binary format without a formats entry is retried as binary and warned', async () => {
    const b = await makeCtx({ files: ['.env'], local: {}, config: { mode: 'sops', sops: { recipient: 'age1fake' } } });
    await b.vault.upsertNote('envsync:kys/app:age-key', 'AGE-SECRET-KEY-FAKE');
    b.ctx.backend = new SopsBackend(b.root, b.vault, new FakeSops({ strictFormat: true }), b.ctx.config, async () => {});
    await writeFile(join(b.root, '.env.enc'), 'FAKE:binary:' + Buffer.from('A=1\n').toString('base64'));
    const r = await pull(b.ctx, { force: false });
    expect(r[0]).toMatchObject({ status: 'pulled' });
    expect(r[0].warning).toContain('.envsync.config');
    expect(await readFile(join(b.root, '.env'), 'utf8')).toBe('A=1\n');
  });
});
