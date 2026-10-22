import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveExecutable, spawnRunner, type Runner } from '../src/exec.js';
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

  // 실제 사용처럼 cwd가 .sops.yaml이 있는 디렉터리인 상태로 sops를 실행하는 러너.
  const inDir = (cwd: string): Runner => (cmd, args, opts) => spawnRunner(cmd, args, { ...opts, cwd });

  async function setup(rules: string) {
    const ours = await generateAgeKey();
    await writeFile(path.join(dir, '.sops.yaml'), rules);
    const plain = path.join(dir, '.env');
    await writeFile(plain, 'A=topsecretvalue\nB=otherSecret42\n');
    return { ours, plain, enc: path.join(dir, '.env.enc') };
  }

  test('control: without --config, a repo .sops.yaml encrypted_regex leaves plaintext (test can fail)', async () => {
    const { ours, plain } = await setup(`creation_rules:\n  - encrypted_regex: ^nomatch$\n`);
    const r = await spawnRunner(exe!.command, ['encrypt', '--age', ours.recipient, '--input-type', 'dotenv', '--output-type', 'dotenv', plain], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout.toString('utf8')).toContain('topsecretvalue');
  });

  test('repo .sops.yaml encrypted_regex does not leave plaintext', async () => {
    const { ours, plain, enc } = await setup(`creation_rules:\n  - encrypted_regex: ^nomatch$\n    age: ${(await generateAgeKey()).recipient}
`);
    const s = new SopsCli(inDir(dir), exe);
    const out = await s.encryptFile(plain, 'dotenv', ours.recipient);
    const text = out.toString('utf8');
    expect(text).toContain('ENC[');
    expect(text).not.toContain('topsecretvalue');
    expect(text).not.toContain('otherSecret42');
    await writeFile(enc, out);
    expect((await s.decryptFile(enc, 'dotenv', ours.identity)).toString('utf8')).toContain('A=topsecretvalue');
  });

  test('non-matching creation_rules still encrypt', async () => {
    const { ours, plain, enc } = await setup(`creation_rules:\n  - path_regex: ^never-matches-anything$\n    age: ${(await generateAgeKey()).recipient}
`);
    const s = new SopsCli(inDir(dir), exe);
    const out = await s.encryptFile(plain, 'dotenv', ours.recipient);
    expect(out.toString('utf8')).toContain('ENC[');
    await writeFile(enc, out);
    expect((await s.decryptFile(enc, 'dotenv', ours.identity)).toString('utf8')).toContain('B=otherSecret42');
  });
});
