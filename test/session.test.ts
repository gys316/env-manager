import { test, expect } from 'vitest';
import { ensureUnlocked } from '../src/session.js';
import { FakeVault, MemoryIo } from './fakes.js';

test('locked + non-interactive -> VAULT_LOCKED without prompting', async () => {
  const io = new MemoryIo({ interactive: false });
  await expect(ensureUnlocked(new FakeVault({ state: 'locked' }), io)).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
  expect(io.prompts).toHaveLength(0);
});

test('locked + interactive prompts and unlocks', async () => {
  const v = new FakeVault({ state: 'locked', password: 'pw' });
  const io = new MemoryIo({ interactive: true, secret: 'pw' });
  await ensureUnlocked(v, io);
  expect(await v.status()).toBe('unlocked');
  expect(io.prompts).toEqual(['Bitwarden 마스터 비밀번호: ']);
});

test('locked + wrong password -> BW_ERROR', async () => {
  const v = new FakeVault({ state: 'locked', password: 'pw' });
  await expect(ensureUnlocked(v, new MemoryIo({ secret: 'bad' }))).rejects.toMatchObject({ code: 'BW_ERROR' });
});

test('unauthenticated -> NOT_LOGGED_IN with hint', async () => {
  await expect(ensureUnlocked(new FakeVault({ state: 'unauthenticated' }), new MemoryIo())).rejects.toMatchObject({
    code: 'NOT_LOGGED_IN',
    hint: 'bw login',
  });
});

test('unlocked -> returns without prompting', async () => {
  const io = new MemoryIo();
  await ensureUnlocked(new FakeVault({ state: 'unlocked' }), io);
  expect(io.prompts).toHaveLength(0);
});
