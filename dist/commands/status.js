import { readFile } from 'node:fs/promises';
import { localPath } from '../context.js';
import { sha256 } from '../state.js';
export async function status(ctx) {
    const { config, backend, state } = ctx;
    const results = [];
    for (const path of config.files) {
        let local = null;
        try {
            local = await readFile(localPath(ctx.root, path));
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
        }
        const version = await backend.version(path);
        if (!local && version === null)
            results.push({ path, status: 'missing' });
        else if (local && version === null)
            results.push({ path, status: 'local-only' });
        else if (!local)
            results.push({ path, status: 'remote-only' });
        else {
            const rec = state.get(path);
            if (rec) {
                const localChanged = sha256(local) !== rec.hash;
                const remoteChanged = version !== rec.remoteVersion;
                results.push({
                    path,
                    status: localChanged && remoteChanged ? 'conflict' : localChanged ? 'local-changed' : remoteChanged ? 'remote-changed' : 'synced',
                });
            }
            else {
                const remote = await backend.read(path);
                results.push({ path, status: remote && remote.content.equals(local) ? 'synced' : 'differs' });
            }
        }
    }
    return results;
}
