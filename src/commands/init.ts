import { keyNoteName } from '../backend.js';
import { configExists, saveConfig, type Config } from '../config.js';
import type { Deps } from '../context.js';
import { detectFiles } from '../detect.js';
import { EnvsyncError } from '../errors.js';
import { generateAgeKey, recipientOf } from '../keys.js';
import { BACKUP_PATTERN, ensureGitattributes, ensureIgnored, findRepoRoot, isTracked, originUrl, parseRemote } from '../repo.js';
import { ensureUnlocked } from '../session.js';

/** `a/b` 형태(슬래시 1개 이상, 공백 없음, 빈 구간 없음)만 허용한다. */
function validRepo(v: string): boolean {
  return !/\s/.test(v) && v.includes('/') && v.split('/').every((s) => s !== '');
}

function checkRepo(v: string): string {
  const r = v.trim();
  if (!validRepo(r)) throw new EnvsyncError('USAGE', `레포 이름 형식이 올바르지 않습니다: "${r}"`, '--repo owner/repo');
  return r;
}

export async function warnTracked(deps: Deps, root: string, files: string[]): Promise<string[]> {
  const tracked: string[] = [];
  for (const f of files) {
    if (await isTracked(deps.runner, root, f)) {
      tracked.push(f);
      deps.io.warn(`경고: ${f} 파일이 git에 추적 중입니다. 평문 파일이 커밋되지 않도록 'git rm --cached ${f}' 를 실행하세요.`);
    }
  }
  return tracked;
}

export async function init(
  deps: Deps,
  cwd: string,
  opts: { encrypt: boolean; repo?: string; yes: boolean },
): Promise<{ config: Config; ignored: string[]; trackedWarnings: string[] }> {
  const { runner, vault, sops, io } = deps;
  const root = await findRepoRoot(runner, cwd);
  if (await configExists(root)) {
    throw new EnvsyncError('ALREADY_INITIALIZED', '이미 envsync가 초기화된 레포입니다.', 'envsync status');
  }

  let repo: string | null = null;
  if (opts.repo !== undefined) repo = checkRepo(opts.repo);
  else {
    const url = await originUrl(runner, root);
    repo = url ? parseRemote(url) : null;
    if (!repo) {
      if (!io.interactive) {
        throw new EnvsyncError('USAGE', 'origin remote에서 레포 이름을 알 수 없습니다.', '--repo owner/repo');
      }
      repo = checkRepo(await io.prompt('레포 이름 (owner/repo): '));
    }
  }

  const files = await detectFiles(runner, root);
  if (files.length > 0) {
    io.info(`관리할 파일 ${files.length}개:`);
    for (const f of files) io.info(`  ${f}`);
  } else {
    io.info('자동으로 찾은 파일이 없습니다. envsync add <파일> 로 추가하세요.');
  }
  if (!opts.yes) {
    if (!io.interactive) {
      throw new EnvsyncError('CONFIRMATION_REQUIRED', '비대화형에서는 확인이 필요합니다.', '--yes');
    }
    if (!(await io.confirm('이 설정으로 초기화할까요?'))) throw new EnvsyncError('USAGE', '초기화를 취소했습니다.');
  }

  let config: Config = { version: 1, repo, mode: 'vault', files };
  if (opts.encrypt) {
    await sops.checkVersion();
    await ensureUnlocked(vault, io);
    // 낡은 로컬 캐시로 기존 키를 못 찾으면 두 번째 키가 생겨 DUPLICATE_ITEM이 된다.
    await vault.sync();
    const name = keyNoteName(repo);
    const existing = await vault.findNote(name);
    let recipient: string;
    if (existing && existing.notes.trim() !== '') {
      recipient = await recipientOf(existing.notes.trim());
      io.info('Bitwarden에 있는 기존 age 키를 재사용합니다.');
    } else {
      const key = await generateAgeKey();
      await vault.upsertNote(name, key.identity);
      recipient = await recipientOf(key.identity);
      io.info('새 age 키를 만들어 Bitwarden에 저장했습니다.');
    }
    config = { ...config, mode: 'sops', sops: { recipient } };
    await ensureGitattributes(root, '*.enc -text');
  }

  // 평문이 커밋되지 않도록 설정 파일보다 무시 규칙을 먼저 쓴다.
  const ignored = await ensureIgnored(runner, root, [...files, BACKUP_PATTERN, '*.enc.tmp']);
  await saveConfig(root, config);
  const trackedWarnings = await warnTracked(deps, root, files);
  io.info(`초기화 완료: ${config.mode} 모드, 파일 ${files.length}개`);
  const toCommit = ['.envsync.config', '.gitignore', ...(config.mode === 'sops' ? ['.gitattributes'] : [])];
  io.info(`다른 PC에서도 쓸 수 있도록 다음 파일을 커밋하세요: ${toCommit.join(', ')}`);
  return { config, ignored, trackedWarnings };
}
