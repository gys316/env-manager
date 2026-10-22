import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveExecutable, spawnRunner } from '../src/exec.js';
import { generateAgeKey } from '../src/keys.js';
import { SopsCli } from '../src/sops.js';

const exe = resolveExecutable('sops');

const samples = {
  dotenv: 'A=1\nB=한글\n',
  yaml: 'db:\n  password: x\n',
  binary: '# c\r\nA="multi\nline"\r\n',
} as const;

describe.skipIf(!exe)('real sops', () => {
  const sops = new SopsCli(spawnRunner, exe);
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'envsync-sops-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('version check passes', async () => {
    await sops.checkVersion();
  });

  test.each(['dotenv', 'yaml', 'binary'] as const)('round-trip %s', async (fmt) => {
    const key = await generateAgeKey();
    const plain = path.join(dir, 'plain');
    const enc = path.join(dir, 'plain.enc');
    const original = Buffer.from(samples[fmt], 'utf8');
    await writeFile(plain, original);
    await writeFile(enc, await sops.encryptFile(plain, fmt, key.recipient));
    const back = await sops.decryptFile(enc, fmt, key.identity);
    if (fmt === 'binary') expect(back.equals(original)).toBe(true);
    else console.log(`[observe] ${fmt} round-trip byte-identical: ${back.equals(original)}`);
  });

  test('.sops.yaml in repo does not override --age', async () => {
    const other = await generateAgeKey();
    const ours = await generateAgeKey();
    await writeFile(path.join(dir, '.sops.yaml'), `creation_rules:\n  - path_regex: .*\n    age: ${other.recipient}\n`);
    const plain = path.join(dir, '.env');
    const enc = path.join(dir, '.env.enc');
    await writeFile(plain, samples.dotenv);
    await writeFile(enc, await sops.encryptFile(plain, 'dotenv', ours.recipient));
    const back = await sops.decryptFile(enc, 'dotenv', ours.identity);
    expect(back.toString('utf8')).toContain('A=1');
    expect((await readFile(enc, 'utf8')).includes(ours.recipient)).toBe(true);
  });
});
