import { test, expect } from 'vitest';
import { BwCli } from '../src/bitwarden.js';
import { recordingRunner } from './fakes.js';

const exe = { command: 'bw', prefixArgs: [] as string[] };
const decode = (input: unknown) => JSON.parse(Buffer.from(String(input), 'base64').toString('utf8'));

test('session goes through env, never argv', async () => {
  const r = recordingRunner([{ stdout: '{"status":"unlocked"}' }]);
  expect(await new BwCli(r.run, exe, 'TOKEN').status()).toBe('unlocked');
  expect(r.calls[0].args).toEqual(['status']);
  expect(r.calls[0].env?.BW_SESSION).toBe('TOKEN');
  expect(r.calls[0].args.join(' ')).not.toContain('TOKEN');
});

test('no session: BW_SESSION is not set in child env', async () => {
  const r = recordingRunner([{ stdout: '{"status":"locked"}' }]);
  await new BwCli(r.run, exe).status();
  expect(r.calls[0].env && 'BW_SESSION' in r.calls[0].env).toBeFalsy();
});

test('unlock passes password via env only and keeps session for later calls', async () => {
  const r = recordingRunner([{ stdout: 'NEWTOKEN\n' }, { stdout: '' }]);
  const bw = new BwCli(r.run, exe);
  await bw.unlock('hunter2');
  expect(r.calls[0].args).toEqual(['unlock', '--passwordenv', 'ENVSYNC_BW_PASSWORD', '--raw']);
  expect(r.calls[0].env?.ENVSYNC_BW_PASSWORD).toBe('hunter2');
  expect(r.calls[0].args.join(' ')).not.toContain('hunter2');
  await bw.sync();
  expect(r.calls[1].args).toEqual(['sync']);
  expect(r.calls[1].env?.BW_SESSION).toBe('NEWTOKEN');
  expect(r.calls[1].env?.ENVSYNC_BW_PASSWORD).toBeUndefined();
});

test('unlock failure does not leak stderr or password', async () => {
  const r = recordingRunner([{ code: 1, stderr: 'Invalid master password. hunter2' }]);
  const err = await new BwCli(r.run, exe).unlock('hunter2').catch((e) => e);
  expect(err.code).toBe('BW_ERROR');
  expect(err.message).toBe('마스터 비밀번호가 틀렸거나 잠금 해제 실패');
  expect(err.message).not.toContain('hunter2');
});

test('null notes from bw are normalized to empty string', async () => {
  const r = recordingRunner([
    { stdout: '[{"id":"F1","name":"envsync"}]' },
    { stdout: '[{"id":"1","type":2,"name":"n1","notes":null,"revisionDate":"r"}]' },
  ]);
  const bw = new BwCli(r.run, exe, 'T');
  expect(await bw.findNote('n1')).toEqual({ id: '1', name: 'n1', notes: '', revisionDate: 'r' });
  const r2 = recordingRunner([
    { stdout: '[{"id":"F1","name":"envsync"}]' },
    { stdout: '[]' },
    { stdout: '{"id":"I1","name":"n1","notes":null,"revisionDate":"r2"}' },
  ]);
  expect(await new BwCli(r2.run, exe, 'T').upsertNote('n1', '')).toEqual({ id: 'I1', name: 'n1', notes: '', revisionDate: 'r2' });
});

test('create item sends secret via stdin only', async () => {
  const r = recordingRunner([
    { stdout: '[]' },
    { stdout: '{"id":"F1","name":"envsync"}' },
    { stdout: '[]' },
    { stdout: '{"id":"I1","name":"envsync:a/b:.env","notes":"S=1","revisionDate":"r1"}' },
  ]);
  const note = await new BwCli(r.run, exe, 'T').upsertNote('envsync:a/b:.env', 'S=1');
  expect(note.revisionDate).toBe('r1');
  expect(r.calls[0].args).toEqual(['list', 'folders', '--search', 'envsync']);
  expect(r.calls[1].args).toEqual(['create', 'folder']);
  expect(decode(r.calls[1].input)).toEqual({ name: 'envsync' });
  expect(r.calls[2].args).toEqual(['list', 'items', '--folderid', 'F1', '--search', 'envsync:a/b:.env']);
  const create = r.calls[3];
  expect(create.args).toEqual(['create', 'item']);
  expect(create.args.join(' ')).not.toContain('S=1');
  expect(decode(create.input)).toMatchObject({ type: 2, notes: 'S=1', folderId: 'F1', secureNote: { type: 0 } });
});

test('existing folder is reused and cached', async () => {
  const r = recordingRunner([
    { stdout: '[{"id":"F9","name":"envsync-old"},{"id":"F1","name":"envsync"}]' },
    { stdout: '[]' },
    { stdout: '{"id":"I1","name":"n1","notes":"a","revisionDate":"r1"}' },
    { stdout: '[]' },
    { stdout: '{"id":"I2","name":"n2","notes":"b","revisionDate":"r2"}' },
  ]);
  const bw = new BwCli(r.run, exe, 'T');
  await bw.upsertNote('n1', 'a');
  await bw.upsertNote('n2', 'b');
  expect(r.calls.filter((c) => c.args[0] === 'list' && c.args[1] === 'folders')).toHaveLength(1);
  expect(decode(r.calls[2].input).folderId).toBe('F1');
});

test('update existing item replaces only notes, via stdin', async () => {
  const r = recordingRunner([
    { stdout: '[{"id":"F1","name":"envsync"}]' },
    { stdout: '[{"id":"I1","type":2,"name":"n1"}]' },
    { stdout: '{"id":"I1","type":2,"name":"n1","notes":"old","extra":{"k":1},"revisionDate":"r1"}' },
    { stdout: '{"id":"I1","name":"n1","notes":"NEW","revisionDate":"r2"}' },
  ]);
  const note = await new BwCli(r.run, exe, 'T').upsertNote('n1', 'NEW');
  expect(r.calls[2].args).toEqual(['get', 'item', 'I1']);
  expect(r.calls[3].args).toEqual(['edit', 'item', 'I1']);
  expect(r.calls[3].args.join(' ')).not.toContain('NEW');
  expect(decode(r.calls[3].input)).toMatchObject({ id: 'I1', notes: 'NEW', extra: { k: 1 } });
  expect(note).toEqual({ id: 'I1', name: 'n1', notes: 'NEW', revisionDate: 'r2' });
});

test('findNote returns the match and null when absent or no folder', async () => {
  const r = recordingRunner([
    { stdout: '[{"id":"F1","name":"envsync"}]' },
    { stdout: '[{"id":"1","type":2,"name":"n1","notes":"x","revisionDate":"r"},{"id":"2","type":1,"name":"n2"}]' },
    { stdout: '[{"id":"2","type":1,"name":"n2"}]' },
  ]);
  const bw = new BwCli(r.run, exe, 'T');
  expect(await bw.findNote('n1')).toEqual({ id: '1', name: 'n1', notes: 'x', revisionDate: 'r' });
  expect(await bw.findNote('n2')).toBeNull(); // type !== 2
  const r2 = recordingRunner([{ stdout: '[]' }]);
  expect(await new BwCli(r2.run, exe, 'T').findNote('n1')).toBeNull();
  expect(r2.calls).toHaveLength(1); // 폴더를 만들지 않는다
});

test('findNote filters exact name and rejects duplicates', async () => {
  const items = JSON.stringify([
    { id: '1', type: 2, name: 'envsync:a/b:.env' },
    { id: '2', type: 2, name: 'envsync:a/b:.env.local' },
    { id: '3', type: 2, name: 'envsync:a/b:.env' },
  ]);
  const r = recordingRunner([{ stdout: '[{"id":"F1","name":"envsync"}]' }, { stdout: items }]);
  await expect(new BwCli(r.run, exe, 'T').findNote('envsync:a/b:.env')).rejects.toMatchObject({ code: 'DUPLICATE_ITEM' });
});

test('prefixArgs are prepended (npm bw.cmd case)', async () => {
  const r = recordingRunner([{ stdout: '{"status":"locked"}' }]);
  await new BwCli(r.run, { command: 'node', prefixArgs: ['bw.js'] }).status();
  expect(r.calls[0].command).toBe('node');
  expect(r.calls[0].args).toEqual(['bw.js', 'status']);
});

test('error mapping by stderr, message never includes stderr', async () => {
  const mk = (stderr: string, code = 1) => new BwCli(recordingRunner([{ code, stderr }]).run, exe, 'T').sync().catch((e) => e);
  const a = await mk('You are not logged in. SECRET');
  expect(a.code).toBe('NOT_LOGGED_IN');
  const b = await mk('Vault is locked.');
  expect(b.code).toBe('VAULT_LOCKED');
  const c = await mk('boom SECRET');
  expect(c.code).toBe('BW_ERROR');
  for (const e of [a, b, c]) expect(e.message).not.toContain('SECRET');
});

test('null executable throws MISSING_DEPENDENCY on every method', async () => {
  const bw = new BwCli(recordingRunner([]).run, null);
  const calls = [() => bw.status(), () => bw.unlock('x'), () => bw.sync(), () => bw.findNote('n'), () => bw.upsertNote('n', 'c')];
  for (const c of calls) {
    await expect(c()).rejects.toMatchObject({
      code: 'MISSING_DEPENDENCY',
      hint: 'winget install Bitwarden.CLI 또는 npm i -g @bitwarden/cli',
    });
  }
});

test('invalid JSON output gives BW_ERROR without echoing output', async () => {
  const r = recordingRunner([{ stdout: 'notes: SECRET{' }]);
  const err = await new BwCli(r.run, exe, 'T').status().catch((e) => e);
  expect(err.code).toBe('BW_ERROR');
  expect(err.message).not.toContain('SECRET');
});
