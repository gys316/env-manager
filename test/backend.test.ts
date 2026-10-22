import { test, expect } from 'vitest';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { VaultBackend, SopsBackend, noteName, keyNoteName } from '../src/backend.js';
import type { Config } from '../src/config.js';
import type { SopsFormat } from '../src/sops.js';
import { FakeVault, FakeSops } from './fakes.js';
import { tmpRepoWith } from './helpers.js';

const cfg = (o: Partial<Config> = {}): Config => ({ version: 1, repo: 'kys/app', mode: 'vault', files: ['.env'], ...o });
const sopsCfg = (o: Partial<Config> = {}) => cfg({ mode: 'sops', sops: { recipient: 'age1fake' }, ...o });

async function sopsSetup(files: Record<string, string>, sops = new FakeSops(), config = sopsCfg(), withKey = true) {
  const root = await tmpRepoWith(files);
  const vault = new FakeVault({ state: 'unlocked' });
  if (withKey) await vault.upsertNote('envsync:kys/app:age-key', 'AGE-SECRET-KEY-FAKE');
  const saved: Config[] = [];
  const be = new SopsBackend(root, vault, sops, config, async (c) => {
    saved.push(c);
  });
  return { root, vault, be, saved, sops };
}

test('note names', () => {
  expect(noteName('kys/app', 'a/.env')).toBe('envsync:kys/app:a/.env');
  expect(keyNoteName('kys/app')).toBe('envsync:kys/app:age-key');
});

test('vault backend round-trips bytes and returns revisionDate', async () => {
  const be = new VaultBackend(new FakeVault({ state: 'unlocked' }), cfg());
  const content = Buffer.from('A=1\r\nB=한글\r\n');
  const { version } = await be.write('.env', content);
  expect(await be.read('.env')).toEqual({ content, version });
  expect(await be.version('.env')).toBe(version);
});

test('vault backend missing note -> null', async () => {
  const be = new VaultBackend(new FakeVault({ state: 'unlocked' }), cfg());
  expect(await be.read('.env')).toBeNull();
  expect(await be.version('.env')).toBeNull();
});

test('vault backend rejects >7000 bytes', async () => {
  await expect(
    new VaultBackend(new FakeVault({ state: 'unlocked' }), cfg()).write('.env', Buffer.alloc(7001, 'a')),
  ).rejects.toMatchObject({ code: 'NOTE_TOO_LARGE' });
});

test('vault backend accepts exactly 7000 bytes', async () => {
  const be = new VaultBackend(new FakeVault({ state: 'unlocked' }), cfg());
  await expect(be.write('.env', Buffer.alloc(7000, 'a'))).resolves.toHaveProperty('version');
});

test('sops backend write/read round-trip and version is sha of .enc', async () => {
  const { be, root } = await sopsSetup({ '.env': 'A=1\n' });
  expect(await be.version('.env')).toBeNull();
  expect(await be.read('.env')).toBeNull();
  const res = await be.write('.env', Buffer.from('A=1\n'));
  expect(res.warning).toBeUndefined();
  const enc = await readFile(path.join(root, '.env.enc'));
  const { sha256 } = await import('../src/state.js');
  expect(res.version).toBe(sha256(enc));
  expect(await be.version('.env')).toBe(res.version);
  expect(await be.read('.env')).toEqual({ content: Buffer.from('A=1\n'), version: res.version });
});

test('sops backend skips rewrite when unchanged', async () => {
  const sops = new FakeSops();
  let calls = 0;
  const orig = sops.encryptFile.bind(sops);
  sops.encryptFile = async (...a) => {
    calls++;
    return orig(...a);
  };
  const { be } = await sopsSetup({ '.env': 'A=1\n' }, sops);
  const first = await be.write('.env', Buffer.from('A=1\n'));
  const second = await be.write('.env', Buffer.from('A=1\n'));
  expect(calls).toBe(1);
  expect(second.version).toBe(first.version);
});

test('sops backend falls back to binary when lossy', async () => {
  const { be, saved } = await sopsSetup({ '.env': 'A=1\n' }, new FakeSops({ lossy: new Set<SopsFormat>(['dotenv']) }));
  const res = await be.write('.env', Buffer.from('A=1\n'));
  expect(res.warning).toContain('binary');
  expect(saved.at(-1)?.formats).toEqual({ '.env': 'binary' });
  expect((await be.read('.env'))?.content.toString()).toBe('A=1\n');
});

test('sops backend falls back to binary when encrypt fails for the format', async () => {
  const { be, saved, root } = await sopsSetup({ '.env': 'A="x\ny"\n' }, new FakeSops({ failEncrypt: new Set<SopsFormat>(['dotenv']) }));
  const res = await be.write('.env', Buffer.from('A="x\ny"\n'));
  expect(res.warning).toContain('binary');
  expect(saved.at(-1)?.formats).toEqual({ '.env': 'binary' });
  expect((await readFile(path.join(root, '.env.enc'))).toString()).toContain('FAKE:binary:');
  // 이후에는 설정의 binary 형식을 그대로 쓴다.
  expect((await be.read('.env'))?.content.toString()).toBe('A="x\ny"\n');
});

test('sops backend: failure in binary itself is rethrown and leaves no .enc', async () => {
  const { be, root } = await sopsSetup(
    { '.env': 'A=1\n' },
    new FakeSops({ failEncrypt: new Set<SopsFormat>(['dotenv', 'binary']) }),
  );
  await expect(be.write('.env', Buffer.from('A=1\n'))).rejects.toMatchObject({ code: 'SOPS_ERROR' });
  await expect(access(path.join(root, '.env.enc'))).rejects.toBeTruthy();
  await expect(access(path.join(root, '.env.enc.tmp'))).rejects.toBeTruthy();
});

test('sops backend uses configured binary format directly', async () => {
  const { be, saved, root } = await sopsSetup(
    { '.env': 'A=1\n' },
    new FakeSops(),
    sopsCfg({ formats: { '.env': 'binary' } }),
  );
  const res = await be.write('.env', Buffer.from('A=1\n'));
  expect(res.warning).toBeUndefined();
  expect(saved).toEqual([]);
  expect((await readFile(path.join(root, '.env.enc'))).toString()).toContain('FAKE:binary:');
});

test('sops backend rewrites when content changed', async () => {
  const { be, root } = await sopsSetup({ '.env': 'A=1\n' });
  const a = await be.write('.env', Buffer.from('A=1\n'));
  await writeFile(path.join(root, '.env'), 'A=2\n');
  const b = await be.write('.env', Buffer.from('A=2\n'));
  expect(b.version).not.toBe(a.version);
  expect((await be.read('.env'))?.content.toString()).toBe('A=2\n');
});

test('sops backend without key note -> NOT_INITIALIZED', async () => {
  const { be } = await sopsSetup({ '.env': 'A=1\n' }, new FakeSops(), sopsCfg(), false);
  await expect(be.write('.env', Buffer.from('A=1\n'))).rejects.toMatchObject({ code: 'NOT_INITIALIZED' });
});

test('sops backend: key fetched once and cached', async () => {
  const { be, vault } = await sopsSetup({ '.env': 'A=1\n' });
  let finds = 0;
  const orig = vault.findNote.bind(vault);
  vault.findNote = async (n) => {
    finds++;
    return orig(n);
  };
  await be.write('.env', Buffer.from('A=1\n'));
  await be.read('.env');
  expect(finds).toBe(1);
});

test('sops backend trims whitespace around the stored key', async () => {
  const { be, vault } = await sopsSetup({ '.env': 'A=1\n' }, new FakeSops(), sopsCfg(), false);
  await vault.upsertNote('envsync:kys/app:age-key', 'AGE-SECRET-KEY-FAKE\r\n');
  await be.write('.env', Buffer.from('A=1\n'));
  expect((await be.read('.env'))?.content.toString()).toBe('A=1\n');
});

test('vault backend rejects non-UTF-8 content (UTF-16LE with BOM) and NUL bytes', async () => {
  const vault = new FakeVault({ state: 'unlocked' });
  const be = new VaultBackend(vault, cfg());
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('A=secretvalue\r\n', 'utf16le')]);
  const err = await be.write('.env', utf16).catch((e) => e);
  expect(err).toMatchObject({ code: 'UNSUPPORTED_FILE' });
  expect(String(err.message) + String(err.hint)).not.toContain('secretvalue');
  expect(String(err.hint)).toContain('--encrypt');
  await expect(be.write('.env', Buffer.from([0x41, 0x3d, 0x00, 0x31]))).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
  await expect(be.write('.env', Buffer.from([0x41, 0x3d, 0xc3]))).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
  expect(vault.notes.size).toBe(0);
});
