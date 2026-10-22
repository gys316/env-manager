import { test, expect } from 'vitest';
import { resolveExecutable, spawnRunner } from '../src/exec.js';

const win = (files: string[]) => ({ platform: 'win32' as const, pathEnv: 'C:\\a;C:\\npm', exists: (p: string) => files.includes(p), execPath: 'C:\\node\\node.exe' });
test('prefers bw.exe on Windows', () => {
  expect(resolveExecutable('bw', win(['C:\\a\\bw.exe', 'C:\\npm\\bw.cmd'])))
    .toEqual({ command: 'C:\\a\\bw.exe', prefixArgs: [] });
});
test('maps npm bw.cmd to node + bw.js', () => {
  const js = 'C:\\npm\\node_modules\\@bitwarden\\cli\\build\\bw.js';
  expect(resolveExecutable('bw', win(['C:\\npm\\bw.cmd', js])))
    .toEqual({ command: 'C:\\node\\node.exe', prefixArgs: [js] });
});
test('returns null when not found', () => {
  expect(resolveExecutable('sops', win([]))).toBeNull();
});
test('non-bw .cmd is not resolved', () => {
  expect(resolveExecutable('sops', win(['C:\\npm\\sops.cmd']))).toBeNull();
});
test('posix lookup', () => {
  expect(resolveExecutable('sops', { platform: 'linux', pathEnv: '/usr/bin:/opt/bin', exists: p => p === '/opt/bin/sops' }))
    .toEqual({ command: '/opt/bin/sops', prefixArgs: [] });
});
test('spawnRunner passes stdin and env, returns stdout bytes', async () => {
  const r = await spawnRunner(process.execPath,
    ['-e', 'process.stdin.on("data",d=>process.stdout.write(d+process.env.X))'],
    { input: 'hi', env: { X: '!' } });
  expect(r.code).toBe(0);
  expect(r.stdout.toString()).toBe('hi!');
});
test('spawnRunner returns 127 on ENOENT', async () => {
  const r = await spawnRunner('envsync-no-such-command-xyz', []);
  expect(r.code).toBe(127);
});
