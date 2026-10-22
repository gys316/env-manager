import path from 'node:path';
import { SopsBackend, VaultBackend } from './backend.js';
import { isSafeRelPath, loadConfig, saveConfig } from './config.js';
import { EnvsyncError } from './errors.js';
import { findRepoRoot, gitDir } from './repo.js';
import { ensureUnlocked } from './session.js';
import { SyncState } from './state.js';
/** 레포 상대경로를 root 아래의 절대경로로 바꾼다. 벗어나면 USAGE. */
export function localPath(root, rel) {
    if (!isSafeRelPath(rel))
        throw new EnvsyncError('USAGE', `안전하지 않은 경로입니다: ${rel}`);
    const abs = path.resolve(root, ...rel.split('/'));
    const r = path.relative(root, abs);
    if (r === '' || r.startsWith('..') || path.isAbsolute(r)) {
        throw new EnvsyncError('USAGE', `레포 밖을 가리키는 경로입니다: ${rel}`);
    }
    return abs;
}
export function diffFields(d) {
    return d.opaque ? { opaque: true } : { added: d.added, removed: d.removed, changed: d.changed };
}
/** 키 이름만 담은 한 줄 요약. */
export function summaryLine(r) {
    if (r.opaque)
        return `${r.path}: 내용 변경됨`;
    const parts = [
        ...(r.added ?? []).map((k) => `+${k}`),
        ...(r.changed ?? []).map((k) => `~${k}`),
        ...(r.removed ?? []).map((k) => `-${k}`),
    ];
    return `${r.path}: ${parts.length ? parts.join(' ') : '내용 변경됨'}`;
}
/** 레포/설정 오류가 vault·sops 호출보다 먼저 드러나도록 순서를 지킨다. */
export async function createContext(deps, cwd, opts) {
    const { runner, vault, sops, io } = deps;
    const root = await findRepoRoot(runner, cwd);
    const config = await loadConfig(root);
    await ensureUnlocked(vault, io);
    if (opts.sync)
        await vault.sync();
    let backend;
    if (config.mode === 'sops') {
        await sops.checkVersion();
        backend = new SopsBackend(root, vault, sops, config, (c) => saveConfig(root, c));
    }
    else {
        backend = new VaultBackend(vault, config);
    }
    const state = await SyncState.load(await gitDir(runner, root));
    return { root, config, backend, state, io, runner };
}
