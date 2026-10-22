import { test, expect } from 'vitest';
import { describeError, exitCodeFor, EnvsyncError } from '../src/errors.js';

test('exit codes match the table', () => {
  expect(exitCodeFor('NOT_INITIALIZED')).toBe(2);
  expect(exitCodeFor('NOT_LOGGED_IN')).toBe(3);
  expect(exitCodeFor('VAULT_LOCKED')).toBe(4);
  expect(exitCodeFor('CONFLICT')).toBe(5);
  expect(exitCodeFor('PULL_SKIPPED')).toBe(6);
  expect(exitCodeFor('MISSING_DEPENDENCY')).toBe(7);
  expect(exitCodeFor('CONFIRMATION_REQUIRED')).toBe(8);
  expect(exitCodeFor('NOTE_TOO_LARGE')).toBe(9);
  expect(exitCodeFor('UNEXPECTED')).toBe(1);
});

test('group codes and EnvsyncError', () => {
  for (const c of ['USAGE', 'NOT_GIT_REPO', 'ALREADY_INITIALIZED', 'UNSUPPORTED_FILE'] as const) expect(exitCodeFor(c)).toBe(2);
  for (const c of ['DUPLICATE_ITEM', 'BW_ERROR', 'SOPS_ERROR'] as const) expect(exitCodeFor(c)).toBe(9);
  const e = new EnvsyncError('CONFLICT', 'm', 'h');
  expect(e).toBeInstanceOf(Error);
  expect([e.code, e.message, e.hint]).toEqual(['CONFLICT', 'm', 'h']);
});

test('describeError: unexpected errors get a fixed message unless debug', () => {
  const raw = new Error('Invalid checksum in AGE-SECRET-KEY-1SECRET');
  const d = describeError(raw, false);
  expect(d).toEqual({ code: 'UNEXPECTED', message: '예상하지 못한 오류가 발생했습니다 (ENVSYNC_DEBUG=1로 자세히 보기)', files: [] });
  expect(JSON.stringify(d)).not.toContain('AGE-SECRET-KEY');
  expect(describeError('boom', false).message).toBe(d.message);
  const dbg = describeError(raw, true);
  expect(dbg.code).toBe('UNEXPECTED');
  expect(dbg.debug).toContain('Invalid checksum');
});

test('describeError: EnvsyncError passes code, message, hint and details', () => {
  const e = new EnvsyncError('PULL_SKIPPED', 'm', 'h', [{ path: '.env', status: 'skipped' }]);
  expect(describeError(e, false)).toEqual({ code: 'PULL_SKIPPED', message: 'm', hint: 'h', files: [{ path: '.env', status: 'skipped' }] });
});
