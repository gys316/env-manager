import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { configExists, loadConfig, saveConfig } from '../src/config.js';

const tmp = () => mkdtemp(join(tmpdir(), 'c'));
const raw = async (obj: unknown) => {
  const root = await tmp();
  await writeFile(join(root, '.envsync.config'), typeof obj === 'string' ? obj : JSON.stringify(obj));
  return root;
};

describe('config', () => {
  test('round-trips config and normalizes files', async () => {
    const root = await tmp();
    await saveConfig(root, { version: 1, repo: 'kys/app', mode: 'vault', files: ['b/.env', '.env', '.env'] });
    expect((await loadConfig(root)).files).toEqual(['.env', 'b/.env']);
    const text = await readFile(join(root, '.envsync.config'), 'utf8');
    expect(text).toMatch(/\n$/);
    expect(text).toContain('\n  "version": 1');
  });

  test('missing config -> NOT_INITIALIZED with hint', async () => {
    const root = await tmp();
    await expect(loadConfig(root)).rejects.toMatchObject({ code: 'NOT_INITIALIZED', hint: 'envsync init' });
    expect(await configExists(root)).toBe(false);
  });

  test('configExists true after save', async () => {
    const root = await tmp();
    await saveConfig(root, { version: 1, repo: 'a/b', mode: 'vault', files: [] });
    expect(await configExists(root)).toBe(true);
  });

  test('sops mode without recipient is invalid', async () => {
    const root = await raw({ version: 1, repo: 'a/b', mode: 'sops', files: [] });
    await expect(loadConfig(root)).rejects.toMatchObject({ code: 'USAGE' });
  });

  test('sops mode with recipient and formats is valid', async () => {
    const root = await raw({
      version: 1, repo: 'a/b', mode: 'sops', files: ['x.bin'], sops: { recipient: 'age1abc' }, formats: { 'x.bin': 'binary' },
    });
    expect((await loadConfig(root)).sops?.recipient).toBe('age1abc');
  });

  test.each([
    ['invalid json', '{'],
    ['wrong version', { version: 2, repo: 'a/b', mode: 'vault', files: [] }],
    ['empty repo', { version: 1, repo: '', mode: 'vault', files: [] }],
    ['bad mode', { version: 1, repo: 'a/b', mode: 'x', files: [] }],
    ['files not array', { version: 1, repo: 'a/b', mode: 'vault', files: 'x' }],
    ['files non-string', { version: 1, repo: 'a/b', mode: 'vault', files: [1] }],
    ['bad format value', { version: 1, repo: 'a/b', mode: 'vault', files: [], formats: { a: 'text' } }],
    ['formats not object', { version: 1, repo: 'a/b', mode: 'vault', files: [], formats: [] }],
    ['not an object', []],
  ])('invalid: %s -> USAGE', async (_n, body) => {
    await expect(loadConfig(await raw(body as unknown))).rejects.toMatchObject({ code: 'USAGE' });
  });
});
