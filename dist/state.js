import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export function sha256(data) {
    return createHash('sha256').update(data).digest('hex');
}
export class SyncState {
    dir;
    files;
    constructor(dir, files) {
        this.dir = dir;
        this.files = files;
    }
    static async load(gitDir) {
        const dir = join(gitDir, 'envsync');
        const files = {};
        try {
            const parsed = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
            if (parsed?.version === 1 && typeof parsed.files === 'object' && parsed.files !== null) {
                for (const [k, v] of Object.entries(parsed.files)) {
                    const s = v;
                    if (s && typeof s.hash === 'string' && typeof s.remoteVersion === 'string') {
                        files[k] = { hash: s.hash, remoteVersion: s.remoteVersion };
                    }
                }
            }
        }
        catch {
            // missing or corrupt -> empty state
        }
        return new SyncState(dir, files);
    }
    get(path) {
        return Object.hasOwn(this.files, path) ? this.files[path] : undefined;
    }
    set(path, s) {
        this.files[path] = { hash: s.hash, remoteVersion: s.remoteVersion };
    }
    async save() {
        await mkdir(this.dir, { recursive: true });
        await writeFile(join(this.dir, 'state.json'), JSON.stringify({ version: 1, files: this.files }, null, 2) + '\n', 'utf8');
    }
}
