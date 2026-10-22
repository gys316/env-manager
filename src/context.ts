import path from 'node:path';
import type { Backend } from './backend.js';
import type { Config } from './config.js';
import { isSafeRelPath } from './config.js';
import type { KeyDiff } from './diff.js';
import { EnvsyncError } from './errors.js';
import type { Runner } from './exec.js';
import type { Io } from './io.js';
import type { SyncState } from './state.js';

export type Context = {
  root: string;
  config: Config;
  backend: Backend;
  state: SyncState;
  io: Io;
  runner: Runner;
};

export type FileStatus =
  | 'synced'
  | 'local-changed'
  | 'remote-changed'
  | 'conflict'
  | 'local-only'
  | 'remote-only'
  | 'missing'
  | 'differs'
  | 'pushed'
  | 'pulled'
  | 'unchanged'
  | 'skipped'
  | 'local-missing'
  | 'remote-missing';

export type FileResult = {
  path: string;
  status: FileStatus;
  added?: string[];
  removed?: string[];
  changed?: string[];
  opaque?: boolean;
  warning?: string;
};

/** 레포 상대경로를 root 아래의 절대경로로 바꾼다. 벗어나면 USAGE. */
export function localPath(root: string, rel: string): string {
  if (!isSafeRelPath(rel)) throw new EnvsyncError('USAGE', `안전하지 않은 경로입니다: ${rel}`);
  const abs = path.resolve(root, ...rel.split('/'));
  const r = path.relative(root, abs);
  if (r === '' || r.startsWith('..') || path.isAbsolute(r)) {
    throw new EnvsyncError('USAGE', `레포 밖을 가리키는 경로입니다: ${rel}`);
  }
  return abs;
}

export function diffFields(d: KeyDiff): Pick<FileResult, 'added' | 'removed' | 'changed' | 'opaque'> {
  return d.opaque ? { opaque: true } : { added: d.added, removed: d.removed, changed: d.changed };
}

/** 키 이름만 담은 한 줄 요약. */
export function summaryLine(r: FileResult): string {
  if (r.opaque) return `${r.path}: 내용 변경됨`;
  const parts = [
    ...(r.added ?? []).map((k) => `+${k}`),
    ...(r.changed ?? []).map((k) => `~${k}`),
    ...(r.removed ?? []).map((k) => `-${k}`),
  ];
  return `${r.path}: ${parts.length ? parts.join(' ') : '내용 변경됨'}`;
}
