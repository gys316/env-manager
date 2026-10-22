import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { SyncState, sha256 } from '../src/state.js';

test('state persists hashes only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'g'));
  const s = await SyncState.load(dir);
  s.set('.env', { hash: sha256(Buffer.from('A=1')), remoteVersion: 'r1' });
  await s.save();
  const raw = await readFile(join(dir, 'envsync', 'state.json'), 'utf8');
  expect(raw).not.toContain('A=1');
  expect(JSON.parse(raw).version).toBe(1);
  expect((await SyncState.load(dir)).get('.env')?.remoteVersion).toBe('r1');
});

test('corrupt state loads empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'g'));
  await mkdir(join(dir, 'envsync'));
  await writeFile(join(dir, 'envsync', 'state.json'), '{');
  expect((await SyncState.load(dir)).get('.env')).toBeUndefined();
});

test('missing state loads empty; sha256 is hex', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'g'));
  expect((await SyncState.load(dir)).get('x')).toBeUndefined();
  expect(sha256(Buffer.from(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
