import { test, expect } from 'vitest';
import { exitCodeFor, EnvsyncError } from '../src/errors.js';

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
