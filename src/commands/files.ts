import path from 'node:path';
import { isSafeRelPath, loadConfig, saveConfig, type Config } from '../config.js';
import type { Deps } from '../context.js';
import { fileFormat } from '../detect.js';
import { EnvsyncError } from '../errors.js';
import { ensureIgnored, findRepoRoot } from '../repo.js';
import { warnTracked } from './init.js';

/** cwd 기준 입력을 레포 루트 기준 `/` 경로로 바꾼다. */
function toRepoPath(root: string, cwd: string, file: string): string {
  const rel = path.relative(root, path.resolve(cwd, file)).split(path.sep).join('/');
  if (rel === '' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel) || !isSafeRelPath(rel)) {
    throw new EnvsyncError('USAGE', `레포 안의 파일 경로가 아닙니다: ${file}`);
  }
  return rel;
}

export async function addFile(deps: Deps, cwd: string, file: string): Promise<Config> {
  const root = await findRepoRoot(deps.runner, cwd);
  const config = await loadConfig(root);
  const rel = toRepoPath(root, cwd, file);
  if (!fileFormat(rel)) {
    throw new EnvsyncError('UNSUPPORTED_FILE', `지원하지 않는 파일 형식입니다: ${rel}`, '.env 계열 또는 .yml/.yaml 파일만 가능합니다.');
  }
  const next: Config = config.files.includes(rel) ? config : { ...config, files: [...config.files, rel] };
  if (next !== config) await saveConfig(root, next);
  await ensureIgnored(deps.runner, root, [rel]);
  await warnTracked(deps, root, [rel]);
  deps.io.info(next === config ? `이미 관리 중입니다: ${rel}` : `추가했습니다: ${rel}`);
  return next;
}

export async function removeFile(deps: Deps, cwd: string, file: string): Promise<Config> {
  const root = await findRepoRoot(deps.runner, cwd);
  const config = await loadConfig(root);
  const rel = toRepoPath(root, cwd, file);
  if (!config.files.includes(rel)) {
    deps.io.info(`관리 목록에 없습니다: ${rel}`);
    return config;
  }
  const next: Config = { ...config, files: config.files.filter((f) => f !== rel) };
  await saveConfig(root, next);
  deps.io.info(`목록에서 뺐습니다: ${rel}`);
  deps.io.info('Bitwarden 항목과 .gitignore 항목은 그대로 둡니다 (평문 파일이 실수로 커밋되지 않도록).');
  return next;
}
