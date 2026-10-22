import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
export const spawnRunner = (command, args, opts = {}) => new Promise((resolve, reject) => {
    const child = spawn(command, args, {
        shell: false,
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    let settled = false;
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
        if (settled)
            return;
        settled = true;
        if (e.code === 'ENOENT')
            resolve({ code: 127, stdout: Buffer.alloc(0), stderr: '' });
        else
            reject(e);
    });
    child.on('close', (code) => {
        if (settled)
            return;
        settled = true;
        resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') });
    });
    // 자식이 stdin을 읽기 전에 종료해도 EPIPE로 죽지 않게 한다.
    child.stdin.on('error', () => { });
    child.stdin.end(opts.input);
});
export function resolveExecutable(name, deps = {}) {
    const platform = deps.platform ?? process.platform;
    const win = platform === 'win32';
    const pathEnv = deps.pathEnv ?? (win ? (process.env.PATH ?? process.env.Path ?? '') : (process.env.PATH ?? ''));
    const exists = deps.exists ?? existsSync;
    const execPath = deps.execPath ?? process.execPath;
    const p = win ? path.win32 : path.posix;
    const dirs = pathEnv.split(win ? ';' : ':').filter((d) => d.length > 0);
    for (const dir of dirs) {
        if (!win) {
            const candidate = p.join(dir, name);
            if (exists(candidate))
                return { command: candidate, prefixArgs: [] };
            continue;
        }
        const exe = p.join(dir, `${name}.exe`);
        if (exists(exe))
            return { command: exe, prefixArgs: [] };
        if (name === 'bw' && exists(p.join(dir, 'bw.cmd'))) {
            const js = p.join(dir, 'node_modules', '@bitwarden', 'cli', 'build', 'bw.js');
            if (exists(js))
                return { command: execPath, prefixArgs: [js] };
        }
    }
    return null;
}
