#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { BwCli } from './bitwarden.js';
import { addFile, removeFile } from './commands/files.js';
import { init } from './commands/init.js';
import { pull } from './commands/pull.js';
import { push } from './commands/push.js';
import { status } from './commands/status.js';
import { createContext, type Deps, type FileResult } from './context.js';
import { EnvsyncError, exitCodeFor, type ErrorCode } from './errors.js';
import { resolveExecutable, spawnRunner } from './exec.js';
import { createTerminalIo, type Io } from './io.js';
import { SopsCli } from './sops.js';

type Globals = { yes?: boolean; json?: boolean; force?: boolean };
type Outcome = { files: FileResult[]; extra?: Record<string, unknown> };

const SYMBOLS: Partial<Record<FileResult['status'], string>> = {
  pushed: '✓',
  pulled: '✓',
  unchanged: '✓',
  synced: '✓',
};

function fileLine(r: FileResult): string {
  const parts = [
    ...(r.added ?? []).map((k) => `+${k}`),
    ...(r.changed ?? []).map((k) => `~${k}`),
    ...(r.removed ?? []).map((k) => `-${k}`),
  ];
  const keys = r.opaque ? ['(내용 변경됨)'] : parts;
  return [`${SYMBOLS[r.status] ?? '!'} ${r.path}`, r.status, ...keys].join('  ');
}

/** json 모드에서는 stdout에 JSON 한 줄만, 사람이 읽는 글은 모두 stderr로 보낸다. */
async function execute(command: string, g: Globals, fn: (deps: Deps, io: Io) => Promise<Outcome>): Promise<void> {
  const json = !!g.json;
  const base = createTerminalIo({ json });
  const warnings: string[] = [];
  const io: Io = {
    ...base,
    warn: (msg) => {
      warnings.push(msg);
      base.warn(msg);
    },
  };
  const deps: Deps = {
    runner: spawnRunner,
    io,
    vault: new BwCli(spawnRunner, resolveExecutable('bw'), process.env.BW_SESSION || undefined),
    sops: new SopsCli(spawnRunner, resolveExecutable('sops')),
  };

  const emit = (payload: Record<string, unknown>) => void process.stdout.write(`${JSON.stringify(payload)}\n`);

  try {
    const { files, extra } = await fn(deps, io);
    if (json) emit({ ok: true, command, files, warnings, ...extra });
    else for (const f of files) io.info(fileLine(f));
    process.exitCode = 0;
  } catch (e) {
    let code: ErrorCode = 'UNEXPECTED';
    let message: string;
    let hint: string | undefined;
    let files: unknown[] = [];
    if (e instanceof EnvsyncError) {
      code = e.code;
      message = e.message;
      hint = e.hint;
      if (Array.isArray(e.details)) files = e.details;
    } else {
      message = e instanceof Error ? e.message : String(e);
      if (process.env.ENVSYNC_DEBUG === '1' && e instanceof Error && e.stack) io.warn(e.stack);
    }
    if (json) {
      emit({ ok: false, command, error: { code, message, ...(hint ? { hint } : {}) }, files });
    }
    // details(파일별 요약)는 명령이 이미 출력했으므로 메시지와 힌트만 쓴다.
    io.info(`오류: ${message}`);
    if (hint) io.info(`힌트: ${hint}`);
    process.exitCode = exitCodeFor(code);
  }
}

async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name('envsync')
    .description('.env/YAML 비밀 파일을 Bitwarden(선택: SOPS)과 동기화합니다.')
    .option('--yes', '확인 없이 진행')
    .option('--json', 'stdout에 JSON 한 줄로 출력')
    .option('--force', '충돌/로컬 변경을 무시하고 덮어쓰기')
    .exitOverride();
  const g = (): Globals => program.opts<Globals>();
  const cwd = process.cwd();

  program
    .command('init')
    .description('레포에서 envsync를 초기화합니다.')
    .option('--encrypt', 'SOPS(age) 암호화 모드 사용')
    .option('--repo <owner/repo>', '레포 이름을 직접 지정')
    .action((o: { encrypt?: boolean; repo?: string }) =>
      execute('init', g(), async (deps) => {
        const r = await init(deps, cwd, { encrypt: !!o.encrypt, repo: o.repo, yes: !!g().yes });
        return {
          files: [],
          extra: { config: { repo: r.config.repo, mode: r.config.mode, files: r.config.files } },
        };
      }),
    );

  program
    .command('push')
    .description('로컬 파일을 Bitwarden에 올립니다.')
    .action(() =>
      execute('push', g(), async (deps) => {
        const ctx = await createContext(deps, cwd, { sync: true });
        return { files: await push(ctx, { yes: !!g().yes, force: !!g().force }) };
      }),
    );

  program
    .command('pull')
    .description('Bitwarden의 파일을 내려받습니다.')
    .action(() =>
      execute('pull', g(), async (deps) => {
        const ctx = await createContext(deps, cwd, { sync: true });
        return { files: await pull(ctx, { force: !!g().force }) };
      }),
    );

  program
    .command('status')
    .description('로컬과 Bitwarden의 동기화 상태를 봅니다.')
    .action(() =>
      execute('status', g(), async (deps) => {
        const ctx = await createContext(deps, cwd, { sync: true });
        return { files: await status(ctx) };
      }),
    );

  program
    .command('add <file>')
    .description('관리할 파일을 추가합니다.')
    .action((file: string) =>
      execute('add', g(), async (deps) => {
        const c = await addFile(deps, cwd, file);
        return { files: [], extra: { config: { files: c.files } } };
      }),
    );

  program
    .command('remove <file>')
    .description('관리 목록에서 파일을 뺍니다.')
    .action((file: string) =>
      execute('remove', g(), async (deps) => {
        const c = await removeFile(deps, cwd, file);
        return { files: [], extra: { config: { files: c.files } } };
      }),
    );

  try {
    await program.parseAsync(argv, { from: 'node' });
  } catch (e) {
    if (e instanceof CommanderError) {
      // --help, --version 은 0, 그 밖의 사용법 오류는 USAGE(2)
      process.exitCode = e.exitCode === 0 ? 0 : exitCodeFor('USAGE');
      return;
    }
    throw e;
  }
}

main(process.argv).catch((e: unknown) => {
  process.stderr.write(`오류: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = exitCodeFor('UNEXPECTED');
});
