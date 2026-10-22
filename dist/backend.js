import { readFile, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileFormat } from './detect.js';
import { EnvsyncError } from './errors.js';
import { sha256 } from './state.js';
export const noteName = (repo, filePath) => `envsync:${repo}:${filePath}`;
export const keyNoteName = (repo) => `envsync:${repo}:age-key`;
const MAX_NOTE_BYTES = 7000;
export class VaultBackend {
    vault;
    config;
    constructor(vault, config) {
        this.vault = vault;
        this.config = config;
    }
    async read(p) {
        const note = await this.vault.findNote(noteName(this.config.repo, p));
        if (!note)
            return null;
        return { content: Buffer.from(note.notes, 'utf8'), version: note.revisionDate };
    }
    async version(p) {
        const note = await this.vault.findNote(noteName(this.config.repo, p));
        return note ? note.revisionDate : null;
    }
    async write(p, content) {
        // 노트는 문자열로만 저장되므로 UTF-8로 그대로 되돌릴 수 없는 내용(UTF-16, 바이너리)은 깨진다.
        if (content.includes(0) || !Buffer.from(content.toString('utf8'), 'utf8').equals(content)) {
            throw new EnvsyncError('UNSUPPORTED_FILE', `${p}: UTF-8 텍스트가 아니라 Bitwarden 노트에 그대로 저장할 수 없습니다.`, '파일을 UTF-8로 다시 저장하거나(PowerShell 5.1의 > 리디렉션은 UTF-16으로 저장합니다), envsync init --encrypt 로 sops 모드를 사용하세요.');
        }
        if (content.length > MAX_NOTE_BYTES) {
            throw new EnvsyncError('NOTE_TOO_LARGE', `${p}: 파일이 ${MAX_NOTE_BYTES}바이트를 넘어 Bitwarden 노트에 저장할 수 없습니다.`, 'envsync init --encrypt 로 sops 모드를 사용하세요.');
        }
        const note = await this.vault.upsertNote(noteName(this.config.repo, p), content.toString('utf8'));
        return { version: note.revisionDate };
    }
}
export class SopsBackend {
    root;
    vault;
    sops;
    config;
    onConfigChange;
    identity;
    constructor(root, vault, sops, config, onConfigChange) {
        this.root = root;
        this.vault = vault;
        this.sops = sops;
        this.config = config;
        this.onConfigChange = onConfigChange;
    }
    encPath(p) {
        return path.join(this.root, ...p.split('/')) + '.enc';
    }
    format(p) {
        return this.config.formats?.[p] ?? fileFormat(p) ?? 'dotenv';
    }
    recipient() {
        const r = this.config.sops?.recipient;
        if (!r)
            throw new EnvsyncError('NOT_INITIALIZED', 'sops 수신자(recipient) 설정이 없습니다.', 'envsync init --encrypt');
        return r;
    }
    /** 개인키는 처음 필요할 때 한 번만 읽어 인스턴스 메모리에만 둔다. */
    async key() {
        if (this.identity)
            return this.identity;
        const note = await this.vault.findNote(keyNoteName(this.config.repo));
        const identity = note?.notes.trim() ?? '';
        if (identity === '') {
            throw new EnvsyncError('NOT_INITIALIZED', 'Bitwarden에 age 개인키 항목이 없습니다.', 'envsync init --encrypt 로 키를 만들거나 다른 기기에서 키를 옮겨 오세요.');
        }
        return (this.identity = identity);
    }
    async readEnc(p) {
        try {
            return await readFile(this.encPath(p));
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return null;
            throw e;
        }
    }
    async version(p) {
        const enc = await this.readEnc(p);
        return enc ? sha256(enc) : null;
    }
    async read(p) {
        const enc = await this.readEnc(p);
        if (!enc)
            return null;
        const identity = await this.key();
        const f = this.format(p);
        const version = sha256(enc);
        const isSopsError = (e) => e instanceof EnvsyncError && e.code === 'SOPS_ERROR';
        try {
            return { content: await this.sops.decryptFile(this.encPath(p), f, identity), version };
        }
        catch (e) {
            if (f === 'binary' || !isSopsError(e))
                throw e;
        }
        // 다른 PC에서 binary로 바꾼 뒤 .envsync.config의 formats를 커밋하지 않은 경우: binary로 다시 시도한다.
        // (sops는 형식이 다르면 복호화에 실패하므로, binary로 성공하면 binary 암호문이다.)
        try {
            const content = await this.sops.decryptFile(this.encPath(p), 'binary', identity);
            return {
                content,
                version,
                warning: `${p}: .enc 파일이 binary 형식인데 .envsync.config의 formats에 기록이 없습니다. 이 파일을 binary로 바꾼 PC에서 .envsync.config를 커밋했는지 확인하세요.`,
            };
        }
        catch (e) {
            if (!isSopsError(e))
                throw e;
            throw new EnvsyncError('SOPS_ERROR', `${p}.enc 복호화에 실패했습니다.`, `.envsync.config의 형식(formats) 기록이 .enc와 맞지 않거나(.envsync.config가 .enc와 함께 커밋되었는지 확인), 이 레포의 age 키가 아니거나, 파일이 손상되었습니다.`);
        }
    }
    /**
     * 전제: sops.encryptFile은 작업 트리의 평문 파일(<root>/<path>)을 직접 읽으므로,
     * 인자로 받은 content는 디스크의 그 파일 내용과 같아야 한다(push는 항상 디스크에서 읽은 내용을 넘긴다).
     * 암호문만 `<path>.enc.tmp`에 쓴 뒤 rename한다. 평문은 어디에도 쓰지 않는다.
     */
    async write(p, content) {
        const identity = await this.key();
        const recipient = this.recipient();
        const encPath = this.encPath(p);
        const plainPath = path.join(this.root, ...p.split('/'));
        // (1) 기존 암호문이 이미 같은 내용이면 쓰지 않는다.
        const existing = await this.readEnc(p);
        if (existing) {
            try {
                const current = await this.sops.decryptFile(encPath, this.format(p), identity);
                if (current.equals(content))
                    return { version: sha256(existing) };
            }
            catch (e) {
                // 복호화 불가(손상, 형식 변경 등)면 새로 암호화해 덮어쓴다.
                if (!(e instanceof EnvsyncError && e.code === 'SOPS_ERROR'))
                    throw e;
            }
        }
        // (2) 형식 f로 암호화 후 즉시 복호화해 바이트 비교한다.
        const f = this.format(p);
        const attempt = async (fmt) => {
            let cipher;
            try {
                cipher = await this.sops.encryptFile(plainPath, fmt, recipient);
            }
            catch (e) {
                if (fmt !== 'binary' && e instanceof EnvsyncError && e.code === 'SOPS_ERROR')
                    return null;
                throw e;
            }
            // 검증을 통과한 암호문만 .enc로 올린다(.tmp에서 복호화해 확인).
            const tmp = encPath + '.tmp';
            try {
                await writeFile(tmp, cipher);
                const back = await this.sops.decryptFile(tmp, fmt, identity);
                if (!back.equals(content))
                    return null;
                await rename(tmp, encPath);
                return cipher;
            }
            finally {
                await rm(tmp, { force: true });
            }
        };
        let cipher = await attempt(f);
        if (cipher)
            return { version: sha256(cipher) };
        if (f === 'binary') {
            throw new EnvsyncError('SOPS_ERROR', `${p}: binary 형식으로 암호화한 내용이 원본과 일치하지 않습니다.`);
        }
        // (3) 보존되지 않거나 암호화가 실패한 형식은 binary로 대체한다.
        cipher = await attempt('binary');
        if (!cipher)
            throw new EnvsyncError('SOPS_ERROR', `${p}: binary 형식으로 암호화한 내용이 원본과 일치하지 않습니다.`);
        this.config = { ...this.config, formats: { ...this.config.formats, [p]: 'binary' } };
        await this.onConfigChange(this.config);
        return {
            version: sha256(cipher),
            configChanged: true,
            warning: `${p}: SOPS ${f} 형식에서 내용이 보존되지 않아 binary 형식으로 암호화했습니다 (git diff에 키 이름이 보이지 않음)`,
        };
    }
}
