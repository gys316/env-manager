import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Runner } from './exec.js';
import { ignoredSet } from './repo.js';

export type FileFormat = 'dotenv' | 'yaml';

/** git 설정과 상관없이 들어가지 않는 폴더(의존성·빌드 산출물). */
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', 'build', 'target', 'vendor', '.next']);
/** 이름의 `.`로 나뉜 구간 중 하나라도 이것이면 예시 파일로 보고 제외한다(`.env.local.example` 등). */
const EXAMPLE_SEGMENTS = new Set(['example', 'sample', 'template']);
const EXCLUDED_EXT = ['.enc'];

export function fileFormat(relPath: string): FileFormat | null {
  const base = relPath.split('/').pop() ?? relPath;
  const lower = base.toLowerCase();
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (base === '.env' || base.startsWith('.env.')) return 'dotenv';
  return null;
}

function isExampleName(base: string): boolean {
  return base
    .toLowerCase()
    .split('.')
    .slice(1)
    .some((seg) => EXAMPLE_SEGMENTS.has(seg));
}

/**
 * 폴더를 단계별로 훑는다. 각 단계의 하위 폴더는 git check-ignore 한 번으로 검사해,
 * 폴더 자체가 git에서 무시되면(예: `.venv/`, `/out/`) 그 안으로 들어가지 않는다.
 */
async function listFiles(runner: Runner, root: string): Promise<string[]> {
  const files: string[] = [];
  let level = [''];
  while (level.length > 0) {
    const subdirs: string[] = [];
    for (const dir of level) {
      const entries = await readdir(path.join(root, ...dir.split('/').filter(Boolean)), { withFileTypes: true });
      for (const e of entries) {
        const rel = dir === '' ? e.name : `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) subdirs.push(rel);
        } else if (e.isFile()) {
          files.push(rel);
        }
      }
    }
    const ignored = await ignoredSet(runner, root, subdirs.map((d) => `${d}/`));
    level = subdirs.filter((d) => !ignored.has(`${d}/`));
  }
  return files;
}

export async function detectFiles(runner: Runner, root: string): Promise<string[]> {
  const result: string[] = [];
  const yaml: string[] = [];
  for (const rel of await listFiles(runner, root)) {
    const base = rel.split('/').pop() as string;
    if (isExampleName(base) || base.includes('.envsync-backup') || EXCLUDED_EXT.some((x) => base.endsWith(x))) continue;
    const fmt = fileFormat(rel);
    if (fmt === 'dotenv') result.push(rel);
    else if (fmt === 'yaml') yaml.push(rel);
  }
  // YAML은 git에서 무시되는 것만(커밋된 설정 파일은 비밀이 아니라고 본다). 한 번의 호출로 검사한다.
  const ignoredYaml = await ignoredSet(runner, root, yaml);
  for (const y of yaml) if (ignoredYaml.has(y)) result.push(y);
  return result.sort();
}
