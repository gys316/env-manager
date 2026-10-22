import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { push } from '../../src/commands/push.js';
import { pull } from '../../src/commands/pull.js';
import { SopsBackend } from '../../src/backend.js';
import type { Config } from '../../src/config.js';
import type { SopsFormat } from '../../src/sops.js';
import { FakeSops, FakeVault, MemoryIo } from '../fakes.js';
import { makeCtx } from './ctx.js';

const N = 'envsync:kys/app:.env';
const opts = { yes: true, force: false };

describe('push', () => {
  test('push then pull on a fresh clone restores bytes exactly (CRLF, BOM, 한글)', async () => {
    const content = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('A=1\r\nNAME=한글\r\n')]);
    const a = await makeCtx({ files: ['.env'], local: { '.env': content } });
    await push(a.ctx, opts);
    const b = await makeCtx({ files: ['.env'], local: {}, vault: a.vault });
    expect((await pull(b.ctx, { force: false }))[0].status).toBe('pulled');
    expect(await readFile(join(b.root, '.env'))).toEqual(content);
  });

  test('local-missing when file absent', async () => {
    const a = await makeCtx({ files: ['.env'], local: {} });
    expect((await push(a.ctx, opts))[0].status).toBe('local-missing');
  });

  test('push detects remote change since last sync', async () => {
    const a = await makeCtx({ files: ['.env'], local: { '.env': 'A=1' } });
    await push(a.ctx, opts);
    await a.vault.upsertNote(N, 'A=2');
    await writeFile(join(a.root, '.env'), 'A=3');
    await expect(push(a.ctx, opts)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await a.vault.findNote(N))?.notes).toBe('A=2');
  });

  test('conflict carries results in details; force overrides', async () => {
    const a = await makeCtx({ files: ['.env'], local: { '.env': 'A=1' } });
    await push(a.ctx, opts);
    await a.vault.upsertNote(N, 'A=2');
    await writeFile(join(a.root, '.env'), 'A=3');
    const err = await push(a.ctx, opts).catch((e) => e);
    expect(err.details).toMatchObject([{ path: '.env', status: 'conflict' }]);
    const r = await push(a.ctx, { yes: true, force: true });
    expect(r[0].status).toBe('pushed');
    expect((await a.vault.findNote(N))?.notes).toBe('A=3');
  });

  test('push on fresh clone with differing remote is a conflict', async () => {
    const a = await makeCtx({ files: ['.env'], local: { '.env': 'A=1' } });
    await push(a.ctx, opts);
    const b = await makeCtx({ files: ['.env'], local: { '.env': 'A=9' }, vault: a.vault });
    await expect(push(b.ctx, opts)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await a.vault.findNote(N))?.notes).toBe('A=1');
  });

  test('identical remote on fresh clone is unchanged and records state', async () => {
    const a = await makeCtx({ files: ['.env'], local: { '.env': 'A=1' } });
    await push(a.ctx, opts);
    const b = await makeCtx({ files: ['.env'], local: { '.env': 'A=1' }, vault: a.vault });
    expect((await push(b.ctx, opts))[0].status).toBe('unchanged');
    expect(b.ctx.state.get('.env')).toBeDefined();
  });

  test('conflict anywhere writes nothing for other files', async () => {
    const a = await makeCtx({ files: ['.env', '.env.b'], local: { '.env': 'A=1', '.env.b': 'B=1' } });
    await push(a.ctx, opts);
    await a.vault.upsertNote('envsync:kys/app:.env.b', 'B=2');
    await writeFile(join(a.root, '.env'), 'A=5');
    await writeFile(join(a.root, '.env.b'), 'B=5');
    await expect(push(a.ctx, opts)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await a.vault.findNote(N))?.notes).toBe('A=1');
  });

  test('non-interactive push without --yes -> CONFIRMATION_REQUIRED', async () => {
    const a = await makeCtx({ files: ['.env'], local: { '.env': 'A=1' }, io: new MemoryIo({ interactive: false }) });
    await expect(push(a.ctx, { yes: false, force: false })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(a.vault.notes.size).toBe(0);
  });

  test('CONFIRMATION_REQUIRED carries candidate files with key names only', async () => {
    const a = await makeCtx({
      files: ['.env', '.env.b'],
      local: { '.env': 'NEW_KEY=topsecret\n', '.env.b': 'B=1' },
      io: new MemoryIo({ interactive: false }),
    });
    await a.vault.upsertNote('envsync:kys/app:.env.b', 'B=1');
    const err = await push(a.ctx, { yes: false, force: false }).catch((e) => e);
    expect(err.code).toBe('CONFIRMATION_REQUIRED');
    expect(err.details).toEqual([{ path: '.env', status: 'pushed', added: ['NEW_KEY'], removed: [], changed: [] }]);
    expect(JSON.stringify(err.details)).not.toContain('topsecret');
  });

  test('with --yes the command itself prints no per-file summary (cli prints the result once)', async () => {
    const a = await makeCtx({ files: ['.env'], local: { '.env': 'SECRET_TOKEN=x' } });
    await push(a.ctx, opts);
    expect(a.io.messages.filter((m) => m.includes('SECRET_TOKEN'))).toEqual([]);
  });

  test('declined confirm writes nothing', async () => {
    const a = await makeCtx({ files: ['.env'], local: { '.env': 'A=1' }, io: new MemoryIo({ confirmAnswer: false }) });
    const r = await push(a.ctx, { yes: false, force: false });
    expect(r[0].status).toBe('skipped');
    expect(a.vault.notes.size).toBe(0);
  });

  test('push summary shows key names, never values', async () => {
    const a = await makeCtx({ files: ['.env'], local: { '.env': 'SECRET_TOKEN=supersecret' } });
    await push(a.ctx, { yes: false, force: false });
    const out = a.io.messages.join('\n');
    expect(out).toContain('SECRET_TOKEN');
    expect(out).not.toContain('supersecret');
  });

  test('multi-line PEM value never leaks fragments into the summary', async () => {
    const a = await makeCtx({ files: ['.env'], local: { '.env': "CERT='line1\nMIIsecretline==\nend'\n" } });
    const r = await push(a.ctx, opts);
    expect(r[0]).toMatchObject({ added: ['CERT'] });
    expect(JSON.stringify(r) + a.io.messages.join('\n')).not.toContain('MIIsecretline');
  });

  test('binary-format file is opaque, no key names printed', async () => {
    const a = await makeCtx({ files: ['.env'], local: { '.env': 'SECRET_TOKEN=x' }, config: { formats: { '.env': 'binary' } } });
    const r = await push(a.ctx, { yes: false, force: false });
    expect(r[0].opaque).toBe(true);
    expect(a.io.messages.join('\n')).toContain('.env: 내용 변경됨');
    expect(a.io.messages.join('\n')).not.toContain('SECRET_TOKEN');
  });

  test('unsafe path in config is rejected before touching disk', async () => {
    const a = await makeCtx({ files: ['../x'], local: {} });
    await expect(push(a.ctx, opts)).rejects.toMatchObject({ code: 'USAGE' });
  });
});

describe('push (sops mode)', () => {
  const sopsCtx = async (sops: FakeSops) => {
    const a = await makeCtx({
      files: ['.env', '.env.b'],
      local: { '.env': 'A=1\n', '.env.b': 'B=1\n' },
      config: { mode: 'sops', sops: { recipient: 'age1fake' } },
    });
    await a.vault.upsertNote('envsync:kys/app:age-key', 'AGE-SECRET-KEY-FAKE');
    const saved: Config[] = [];
    a.ctx.backend = new SopsBackend(a.root, a.vault, sops, a.ctx.config, async (c) => {
      saved.push(c);
    });
    return { ...a, saved };
  };

  test('lists the .enc files to commit', async () => {
    const a = await sopsCtx(new FakeSops());
    await push(a.ctx, opts);
    const out = a.io.messages.join('\n');
    expect(out).toContain('.env.enc, .env.b.enc');
    expect(out).not.toContain('.envsync.config');
  });

  test('when formats change, says .envsync.config must be committed with the .enc files', async () => {
    const a = await sopsCtx(new FakeSops({ lossy: new Set<SopsFormat>(['dotenv']) }));
    await push(a.ctx, opts);
    expect(a.saved.at(-1)?.formats).toEqual({ '.env': 'binary', '.env.b': 'binary' });
    expect(a.io.messages.join('\n')).toContain('.envsync.config, .env.enc, .env.b.enc');
  });
});
