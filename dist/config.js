import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EnvsyncError } from './errors.js';
export const CONFIG_FILE = '.envsync.config';
const bad = (why) => new EnvsyncError('USAGE', `${CONFIG_FILE} 형식이 올바르지 않습니다: ${why}`, `${CONFIG_FILE}을(를) 고치거나 envsync init으로 다시 만드세요`);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.length > 0;
export function isSafeRelPath(p) {
    if (p === '' || p.includes('\\') || p.startsWith('/') || /^[A-Za-z]:/.test(p))
        return false;
    return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}
function checkPath(p, where) {
    if (!isSafeRelPath(p))
        throw bad(`${where}에 안전하지 않은 경로가 있습니다: "${p}"`);
}
function validate(v) {
    if (!isObj(v))
        throw bad('최상위가 객체가 아닙니다');
    if (v.version !== 1)
        throw bad('version은 1이어야 합니다');
    if (!nonEmpty(v.repo))
        throw bad('repo가 비어 있습니다');
    if (v.mode !== 'vault' && v.mode !== 'sops')
        throw bad("mode는 'vault' 또는 'sops'여야 합니다");
    if (!Array.isArray(v.files) || !v.files.every((f) => typeof f === 'string'))
        throw bad('files는 문자열 배열이어야 합니다');
    for (const f of v.files)
        checkPath(f, 'files');
    const config = { version: 1, repo: v.repo, mode: v.mode, files: v.files };
    if (v.sops !== undefined) {
        if (!isObj(v.sops) || !nonEmpty(v.sops.recipient))
            throw bad('sops.recipient가 비어 있습니다');
        config.sops = { recipient: v.sops.recipient };
    }
    if (v.mode === 'sops' && !config.sops)
        throw bad('sops 모드에는 sops.recipient가 필요합니다');
    if (v.formats !== undefined) {
        if (!isObj(v.formats) || !Object.values(v.formats).every((x) => x === 'binary')) {
            throw bad("formats의 값은 'binary'만 가능합니다");
        }
        for (const k of Object.keys(v.formats))
            checkPath(k, 'formats');
        config.formats = { ...v.formats };
    }
    return config;
}
export async function configExists(root) {
    try {
        await access(join(root, CONFIG_FILE));
        return true;
    }
    catch {
        return false;
    }
}
export async function loadConfig(root) {
    let text;
    try {
        text = await readFile(join(root, CONFIG_FILE), 'utf8');
    }
    catch (e) {
        if (e.code === 'ENOENT') {
            throw new EnvsyncError('NOT_INITIALIZED', `${CONFIG_FILE} 파일이 없습니다`, 'envsync init');
        }
        throw e;
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw bad('JSON을 해석할 수 없습니다');
    }
    return validate(parsed);
}
export async function saveConfig(root, config) {
    const out = { ...config, files: [...new Set(config.files)].sort() };
    await writeFile(join(root, CONFIG_FILE), JSON.stringify(out, null, 2) + '\n', 'utf8');
}
