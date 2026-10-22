import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { push } from '../../src/commands/push.js';
import { status } from '../../src/commands/status.js';
import { FakeVault } from '../fakes.js';
import { makeCtx } from './ctx.js';

const N = 'envsync:kys/app:.env';
const st = async (c: Awaited<ReturnType<typeof makeCtx>>) => (await status(c.ctx))[0].status;

test('status reports synced / local-changed / remote-changed / conflict / local-only', async () => {
  const a = await makeCtx({ files: ['.env'], local: { '.env': 'A=1' } });
  expect(await st(a)).toBe('local-only');
  await push(a.ctx, { yes: true, force: false });
  expect(await st(a)).toBe('synced');
  await writeFile(join(a.root, '.env'), 'A=2');
  expect(await st(a)).toBe('local-changed');
  await a.vault.upsertNote(N, 'A=7');
  expect(await st(a)).toBe('conflict');
  await writeFile(join(a.root, '.env'), 'A=1');
  expect(await st(a)).toBe('remote-changed');
});

test('status missing / remote-only / differs / synced without state', async () => {
  const empty = await makeCtx({ files: ['.env'], local: {} });
  expect(await st(empty)).toBe('missing');
  const vault = new FakeVault({ state: 'unlocked' });
  await vault.upsertNote(N, 'A=1');
  expect(await st(await makeCtx({ files: ['.env'], local: {}, vault }))).toBe('remote-only');
  expect(await st(await makeCtx({ files: ['.env'], local: { '.env': 'A=2' }, vault }))).toBe('differs');
  expect(await st(await makeCtx({ files: ['.env'], local: { '.env': 'A=1' }, vault }))).toBe('synced');
});

test('status does not write state file', async () => {
  const a = await makeCtx({ files: ['.env'], local: { '.env': 'A=1' } });
  await status(a.ctx);
  const { existsSync } = await import('node:fs');
  expect(existsSync(join(a.root, '.git', 'envsync', 'state.json'))).toBe(false);
});
