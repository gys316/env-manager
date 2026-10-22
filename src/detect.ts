import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Runner } from './exec.js';
import { isIgnored } from './repo.js';

export type FileFormat = 'dotenv' | 'yaml';

const SKIP_DIRS = new Set(['node_modules', '.git']);
const EXAMPLE_NAMES = new Set(['.env.example', '.env.sample', '.env.template']);
const EXCLUDED_EXT = ['.enc', '.envsync-backup'];

export function fileFormat(relPath: string): FileFormat | null {
  const base = relPath.split('/').pop() ?? relPath;
  const lower = base.toLowerCase();
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (base === '.env' || base.startsWith('.env.')) return 'dotenv';
  return null;
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  for (const e of entries) {
    const rel = dir === '' ? e.name : `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(root, rel, out);
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
}

export async function detectFiles(runner: Runner, root: string): Promise<string[]> {
  const all: string[] = [];
  await walk(root, '', all);
  const result: string[] = [];
  for (const rel of all) {
    const base = rel.split('/').pop() as string;
    if (EXAMPLE_NAMES.has(base) || EXCLUDED_EXT.some((x) => base.endsWith(x))) continue;
    const fmt = fileFormat(rel);
    if (fmt === 'dotenv') result.push(rel);
    else if (fmt === 'yaml' && (await isIgnored(runner, root, rel))) result.push(rel);
  }
  return result.sort();
}
