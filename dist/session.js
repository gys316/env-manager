import { EnvsyncError } from './errors.js';
export async function ensureUnlocked(vault, io) {
    const status = await vault.status();
    if (status === 'unlocked')
        return;
    if (status === 'unauthenticated') {
        throw new EnvsyncError('NOT_LOGGED_IN', 'Bitwarden에 로그인되어 있지 않습니다.', 'bw login');
    }
    if (!io.interactive) {
        throw new EnvsyncError('VAULT_LOCKED', 'Bitwarden 보관함이 잠겨 있고 비대화형이라 잠금을 풀 수 없습니다.', '터미널에서 envsync 명령을 직접 실행하거나, BW_SESSION을 설정한 셸에서 실행하세요.');
    }
    const password = await io.promptSecret('Bitwarden 마스터 비밀번호: ');
    await vault.unlock(password);
}
