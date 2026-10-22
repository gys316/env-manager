export type ErrorCode =
  | 'UNEXPECTED'
  | 'NOT_INITIALIZED'
  | 'USAGE'
  | 'NOT_GIT_REPO'
  | 'ALREADY_INITIALIZED'
  | 'UNSUPPORTED_FILE'
  | 'NOT_LOGGED_IN'
  | 'VAULT_LOCKED'
  | 'CONFLICT'
  | 'PULL_SKIPPED'
  | 'MISSING_DEPENDENCY'
  | 'CONFIRMATION_REQUIRED'
  | 'NOTE_TOO_LARGE'
  | 'DUPLICATE_ITEM'
  | 'BW_ERROR'
  | 'SOPS_ERROR';

export class EnvsyncError extends Error {
  code: ErrorCode;
  hint?: string;
  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'EnvsyncError';
    this.code = code;
    this.hint = hint;
  }
}

const EXIT_CODES: Record<ErrorCode, number> = {
  UNEXPECTED: 1,
  NOT_INITIALIZED: 2,
  USAGE: 2,
  NOT_GIT_REPO: 2,
  ALREADY_INITIALIZED: 2,
  UNSUPPORTED_FILE: 2,
  NOT_LOGGED_IN: 3,
  VAULT_LOCKED: 4,
  CONFLICT: 5,
  PULL_SKIPPED: 6,
  MISSING_DEPENDENCY: 7,
  CONFIRMATION_REQUIRED: 8,
  NOTE_TOO_LARGE: 9,
  DUPLICATE_ITEM: 9,
  BW_ERROR: 9,
  SOPS_ERROR: 9,
};

export function exitCodeFor(code: ErrorCode): number {
  return EXIT_CODES[code];
}
