import { NEUTRAL_CONFIG, SopsCli } from '../src/sops.js';
import { FakeSops, recordingRunner } from './fakes.js';

const cfg = ['--config', NEUTRAL_CONFIG];
const exe = { command: 'sops', prefixArgs: [] };

test('decrypt passes identity via env only', async () => {
  const r = recordingRunner([{ stdout: 'A=1\n' }]);
  const out = await new SopsCli(r.run, exe).decryptFile('/r/.env.enc', 'dotenv', 'AGE-SECRET-KEY-1XYZ');
  expect(out.toString()).toBe('A=1\n');
  expect(r.calls[0].args).toEqual([...cfg, 'decrypt', '--input-type', 'dotenv', '--output-type', 'dotenv', '/r/.env.enc']);
  expect(r.calls[0].env?.SOPS_AGE_KEY).toBe('AGE-SECRET-KEY-1XYZ');
  expect(JSON.stringify(r.calls[0].args)).not.toContain('AGE-SECRET-KEY');
});

test('encrypt uses --age and file path, no stdin', async () => {
  const r = recordingRunner([{ stdout: 'CIPHER' }]);
  const out = await new SopsCli(r.run, exe).encryptFile('/r/.env', 'dotenv', 'age1abc');
  expect(out.toString()).toBe('CIPHER');
  expect(r.calls[0].args).toEqual([...cfg, 'encrypt', '--age', 'age1abc', '--input-type', 'dotenv', '--output-type', 'dotenv', '/r/.env']);
  expect(r.calls[0].input).toBeUndefined();
});

test('decrypt failure is SOPS_ERROR without stderr in message', async () => {
  const r = recordingRunner([{ code: 128, stderr: 'secret-leak-xyz' }]);
  const err = await new SopsCli(r.run, exe).decryptFile('/r/.env.enc', 'dotenv', 'AGE-SECRET-KEY-1XYZ').catch((e) => e);
  expect(err).toMatchObject({ code: 'SOPS_ERROR' });
  expect(err.message).not.toContain('secret-leak-xyz');
  expect(err.message).not.toContain('AGE-SECRET-KEY');
});

test('old sops version rejected', async () => {
  const r = recordingRunner([{ stdout: 'sops 3.8.1 (latest)' }]);
  await expect(new SopsCli(r.run, exe).checkVersion()).rejects.toMatchObject({ code: 'MISSING_DEPENDENCY' });
});

test('new sops version accepted', async () => {
  const r = recordingRunner([{ stdout: 'sops 3.10.2 (latest)\n' }]);
  await expect(new SopsCli(r.run, exe).checkVersion()).resolves.toBeUndefined();
  expect(r.calls[0].args).toEqual(['--version', '--disable-version-check']);
});

test('unparseable version rejected', async () => {
  const r = recordingRunner([{ stdout: 'weird' }]);
  await expect(new SopsCli(r.run, exe).checkVersion()).rejects.toMatchObject({ code: 'MISSING_DEPENDENCY' });
});

test('missing executable (null or code 127) is MISSING_DEPENDENCY', async () => {
  const r = recordingRunner([{ code: 127 }]);
  const s = new SopsCli(r.run, null);
  await expect(s.checkVersion()).rejects.toMatchObject({ code: 'MISSING_DEPENDENCY', hint: expect.stringContaining('winget install Mozilla.SOPS') });
  await expect(s.encryptFile('/a', 'dotenv', 'age1')).rejects.toMatchObject({ code: 'MISSING_DEPENDENCY' });
  await expect(s.decryptFile('/a', 'dotenv', 'k')).rejects.toMatchObject({ code: 'MISSING_DEPENDENCY' });
  expect(r.calls).toHaveLength(0);
  await expect(new SopsCli(r.run, exe).checkVersion()).rejects.toMatchObject({ code: 'MISSING_DEPENDENCY' });
});

test('FakeSops round-trips, reads plaintext from disk, enforces identity', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'fakesops-'));
  try {
    const p = path.join(dir, '.env');
    await writeFile(p, 'A=1\n');
    const f = new FakeSops({ lossy: new Set(['yaml']) });
    const enc = await f.encryptFile(p, 'dotenv', 'age1x');
    expect(enc.toString()).toBe('FAKE:dotenv:' + Buffer.from('A=1\n').toString('base64'));
    const encPath = path.join(dir, '.env.enc');
    await writeFile(encPath, enc);
    expect((await f.decryptFile(encPath, 'dotenv', 'AGE-SECRET-KEY-FAKE')).toString()).toBe('A=1\n');
    await expect(f.decryptFile(encPath, 'dotenv', 'other')).rejects.toMatchObject({ code: 'SOPS_ERROR' });
    await writeFile(p, 'a: 1\n');
    await writeFile(encPath, await f.encryptFile(p, 'yaml', 'age1x'));
    expect((await f.decryptFile(encPath, 'yaml', 'AGE-SECRET-KEY-FAKE')).toString()).toBe('a: 1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
