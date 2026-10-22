import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { keyNoteName } from '../../src/backend.js';
import { init } from '../../src/commands/init.js';
import { loadConfig } from '../../src/config.js';
import type { Deps } from '../../src/context.js';
import { spawnRunner } from '../../src/exec.js';
import { generateAgeKey, recipientOf } from '../../src/keys.js';
import { isIgnored } from '../../src/repo.js';
import { FakeSops, FakeVault, MemoryIo } from '../fakes.js';
import { tmpRepoWith } from '../helpers.js';

const deps = (o: Partial<Deps> = {}): Deps => ({
  runner: spawnRunner,
  vault: new FakeVault({ state: 'unauthenticated' }),
  sops: new FakeSops(),
  io: new MemoryIo(),
  ...o,
});

const ORIGIN = { origin: 'git@github.com:kys/app.git' };

describe('init', () => {
  test('vault mode writes config, ignores files, does not touch vault', async () => {
    const root = await tmpRepoWith({ '.env': 'A=1', 'backend/.env.local': 'B=2' }, ORIGIN);
    const vault = new FakeVault({ state: 'unauthenticated' });
    vault.status = async () => {
      throw new Error('vault touched');
    };
    const io = new MemoryIo();
    const { config } = await init(deps({ vault, io }), root, { encrypt: false, yes: true });
    expect(config).toEqual({ version: 1, repo: 'kys/app', mode: 'vault', files: ['.env', 'backend/.env.local'] });
    expect(await loadConfig(root)).toEqual(config);
    expect(io.messages.join('\n')).toContain('커밋하세요: .envsync.config, .gitignore');
    expect(io.messages.join('\n')).not.toContain('.gitattributes');
    expect(await isIgnored(spawnRunner, root, 'backend/.env.local')).toBe(true);
    expect(await isIgnored(spawnRunner, root, 'x.envsync-backup')).toBe(true);
    expect(await isIgnored(spawnRunner, root, 'x.envsync-backup-20261022070503')).toBe(true);
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toContain('*.envsync-backup*');
    expect(await isIgnored(spawnRunner, root, 'x.enc.tmp')).toBe(true);
  });

  test('--encrypt stores key in vault and recipient in config', async () => {
    const root = await tmpRepoWith({ '.env': 'A=1' }, ORIGIN);
    const vault = new FakeVault({ state: 'unlocked' });
    const io = new MemoryIo();
    const { config } = await init(deps({ vault, io }), root, { encrypt: true, yes: true });
    const note = await vault.findNote(keyNoteName('kys/app'));
    expect(note).not.toBeNull();
    expect(config.mode).toBe('sops');
    expect(config.sops?.recipient).toBe(await recipientOf(note!.notes));
    expect(await readFile(path.join(root, '.gitattributes'), 'utf8')).toContain('*.enc -text');
    expect(io.messages.join('\n')).not.toContain(note!.notes);
    expect(io.messages.join('\n')).toContain('커밋하세요: .envsync.config, .gitignore, .gitattributes');
  });

  test('--encrypt reuses an existing key note', async () => {
    const root = await tmpRepoWith({ '.env': 'A=1' }, ORIGIN);
    const vault = new FakeVault({ state: 'unlocked' });
    const key = await generateAgeKey();
    await vault.upsertNote(keyNoteName('kys/app'), key.identity);
    const before = (await vault.findNote(keyNoteName('kys/app')))!.revisionDate;
    const { config } = await init(deps({ vault }), root, { encrypt: true, yes: true });
    expect(config.sops?.recipient).toBe(key.recipient);
    expect((await vault.findNote(keyNoteName('kys/app')))!.revisionDate).toBe(before);
  });

  test('--encrypt tolerates trailing whitespace/newline in a pasted key note', async () => {
    const root = await tmpRepoWith({ '.env': 'A=1' }, ORIGIN);
    const vault = new FakeVault({ state: 'unlocked' });
    const key = await generateAgeKey();
    await vault.upsertNote(keyNoteName('kys/app'), `${key.identity}  \r\n`);
    const { config } = await init(deps({ vault }), root, { encrypt: true, yes: true });
    expect(config.sops?.recipient).toBe(key.recipient);
  });

  test('--encrypt with a malformed key note fails without echoing the key', async () => {
    const root = await tmpRepoWith({ '.env': 'A=1' }, ORIGIN);
    const vault = new FakeVault({ state: 'unlocked' });
    const key = await generateAgeKey();
    await vault.upsertNote(keyNoteName('kys/app'), key.identity.slice(0, -3) + 'QQQ');
    const io = new MemoryIo();
    const err = await init(deps({ vault, io }), root, { encrypt: true, yes: true }).catch((e) => e);
    expect(err).toMatchObject({ code: 'BW_ERROR' });
    expect(`${err.message} ${err.hint} ${io.messages.join(' ')}`).not.toContain(key.identity.slice(0, 24));
  });

  test('--encrypt syncs the vault before looking up the existing key', async () => {
    const root = await tmpRepoWith({ '.env': 'A=1' }, ORIGIN);
    const vault = new FakeVault({ state: 'unlocked' });
    const key = await generateAgeKey();
    // 캐시가 낡아 sync 전에는 키 항목이 보이지 않는 상황
    vault.sync = async () => {
      await vault.upsertNote(keyNoteName('kys/app'), key.identity);
    };
    const { config } = await init(deps({ vault }), root, { encrypt: true, yes: true });
    expect(config.sops?.recipient).toBe(key.recipient);
  });

  test('no origin: non-interactive -> USAGE; --repo works; invalid --repo -> USAGE', async () => {
    const root = await tmpRepoWith({ '.env': 'A=1' });
    const ni = new MemoryIo({ interactive: false });
    await expect(init(deps({ io: ni }), root, { encrypt: false, yes: true })).rejects.toMatchObject({ code: 'USAGE' });
    await expect(init(deps({ io: ni }), root, { encrypt: false, yes: true, repo: 'bad repo' })).rejects.toMatchObject({
      code: 'USAGE',
    });
    await expect(init(deps({ io: ni }), root, { encrypt: false, yes: true, repo: 'norepo' })).rejects.toMatchObject({
      code: 'USAGE',
    });
    const { config } = await init(deps({ io: ni }), root, { encrypt: false, yes: true, repo: 'me/proj' });
    expect(config.repo).toBe('me/proj');
  });

  test('no origin, interactive: prompts for owner/repo; bad answer -> USAGE', async () => {
    const root = await tmpRepoWith({ '.env': 'A=1' });
    const bad = new MemoryIo({ answers: ['nope'] });
    await expect(init(deps({ io: bad }), root, { encrypt: false, yes: true })).rejects.toMatchObject({ code: 'USAGE' });
    const io = new MemoryIo({ answers: ['me/proj'] });
    const { config } = await init(deps({ io }), root, { encrypt: false, yes: true });
    expect(config.repo).toBe('me/proj');
    expect(io.prompts.length).toBe(1);
  });

  test('twice -> ALREADY_INITIALIZED', async () => {
    const root = await tmpRepoWith({ '.env': 'A=1' }, ORIGIN);
    await init(deps(), root, { encrypt: false, yes: true });
    await expect(init(deps(), root, { encrypt: false, yes: true })).rejects.toMatchObject({
      code: 'ALREADY_INITIALIZED',
    });
  });

  test('non-interactive without --yes -> CONFIRMATION_REQUIRED; interactive decline -> no config', async () => {
    const root = await tmpRepoWith({ '.env': 'A=1' }, ORIGIN);
    await expect(
      init(deps({ io: new MemoryIo({ interactive: false }) }), root, { encrypt: false, yes: false }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await expect(
      init(deps({ io: new MemoryIo({ confirmAnswer: false }) }), root, { encrypt: false, yes: false }),
    ).rejects.toMatchObject({ code: 'USAGE' });
    await expect(loadConfig(root)).rejects.toMatchObject({ code: 'NOT_INITIALIZED' });
  });

  test('zero detected files still initializes and hints envsync add', async () => {
    const root = await tmpRepoWith({ 'a.txt': 'x' }, ORIGIN);
    const io = new MemoryIo();
    const { config } = await init(deps({ io }), root, { encrypt: false, yes: true });
    expect(config.files).toEqual([]);
    expect(io.messages.join('\n')).toContain('envsync add');
  });

  test('warns about tracked plaintext env file', async () => {
    const root = await tmpRepoWith({ '.env': 'A=1' }, ORIGIN);
    await spawnRunner('git', ['add', '.env'], { cwd: root });
    await spawnRunner('git', ['commit', '-qm', 'x'], { cwd: root });
    const io = new MemoryIo();
    const r = await init(deps({ io }), root, { encrypt: false, yes: true });
    expect(r.trackedWarnings).toEqual(['.env']);
    expect(io.messages.join('\n')).toContain('git rm --cached');
  });
});
