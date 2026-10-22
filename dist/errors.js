export class EnvsyncError extends Error {
    code;
    hint;
    details;
    constructor(code, message, hint, details) {
        super(message);
        this.name = 'EnvsyncError';
        this.code = code;
        this.hint = hint;
        this.details = details;
    }
}
const EXIT_CODES = {
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
export function exitCodeFor(code) {
    return EXIT_CODES[code];
}
export const UNEXPECTED_MESSAGE = '예상하지 못한 오류가 발생했습니다 (ENVSYNC_DEBUG=1로 자세히 보기)';
/**
 * 사용자에게 보여줄 오류 정보. EnvsyncError가 아닌 오류의 원래 메시지에는 비밀값(예: 키 일부)이 들어갈 수 있어
 * 고정 메시지만 쓰고, debug일 때만 원래 메시지/스택을 debug에 담는다.
 */
export function describeError(e, debug) {
    if (e instanceof EnvsyncError) {
        return {
            code: e.code,
            message: e.message,
            ...(e.hint ? { hint: e.hint } : {}),
            files: Array.isArray(e.details) ? e.details : [],
        };
    }
    const report = { code: 'UNEXPECTED', message: UNEXPECTED_MESSAGE, files: [] };
    if (debug)
        report.debug = e instanceof Error ? (e.stack ?? e.message) : String(e);
    return report;
}
