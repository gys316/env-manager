import { EnvsyncError } from './errors.js';
import type { Executable, Runner, RunResult } from './exec.js';

export type SopsFormat = 'dotenv' | 'yaml' | 'binary';

export interface Sops {
  checkVersion(): Promise<void>;
  encryptFile(plainPath: string, format: SopsFormat, recipient: string): Promise<Buffer>;
  decryptFile(encPath: string, format: SopsFormat, identity: string): Promise<Buffer>;
}

const MISSING_HINT = 'winget install Mozilla.SOPS 또는 brew install sops';
const MIN_VERSION = [3, 9] as const;

export class SopsCli implements Sops {
  constructor(
    private readonly runner: Runner,
    private readonly exe: Executable | null,
  ) {}

  /** 개인키는 env(SOPS_AGE_KEY)로만 전달한다. 오류 메시지에는 stderr/인자를 넣지 않는다. */
  private async sops(args: string[], env?: Record<string, string>): Promise<RunResult> {
    if (!this.exe) throw new EnvsyncError('MISSING_DEPENDENCY', 'sops를 찾을 수 없습니다.', MISSING_HINT);
    const r = await this.runner(this.exe.command, [...this.exe.prefixArgs, ...args], env ? { env } : undefined);
    if (r.code === 127) throw new EnvsyncError('MISSING_DEPENDENCY', 'sops를 실행할 수 없습니다.', MISSING_HINT);
    return r;
  }

  async checkVersion(): Promise<void> {
    const r = await this.sops(['--version']);
    const first = r.stdout.toString('utf8').split(/\r?\n/)[0] ?? '';
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(first);
    const fail = (msg: string): never => {
      throw new EnvsyncError('MISSING_DEPENDENCY', msg, MISSING_HINT);
    };
    if (r.code !== 0 || !m) return fail('sops 버전을 확인할 수 없습니다. 3.9 이상이 필요합니다.');
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (major < MIN_VERSION[0] || (major === MIN_VERSION[0] && minor < MIN_VERSION[1])) {
      fail(`sops ${m[0]}은(는) 너무 낮습니다. 3.9 이상이 필요합니다.`);
    }
  }

  async encryptFile(plainPath: string, format: SopsFormat, recipient: string): Promise<Buffer> {
    // 평문은 작업 트리의 파일을 sops가 직접 읽는다(임시파일 없음).
    // --age를 주면 sops는 레포의 .sops.yaml creation_rules보다 명령행 키를 우선한다(통합 테스트로 확인).
    const r = await this.sops(['encrypt', '--age', recipient, '--input-type', format, '--output-type', format, plainPath]);
    if (r.code !== 0) throw new EnvsyncError('SOPS_ERROR', 'sops 암호화에 실패했습니다.');
    return r.stdout;
  }

  async decryptFile(encPath: string, format: SopsFormat, identity: string): Promise<Buffer> {
    const r = await this.sops(['decrypt', '--input-type', format, '--output-type', format, encPath], {
      SOPS_AGE_KEY: identity,
    });
    if (r.code !== 0) {
      throw new EnvsyncError('SOPS_ERROR', 'sops 복호화에 실패했습니다.', '올바른 age 키인지, 파일이 손상되지 않았는지 확인하세요.');
    }
    return r.stdout;
  }
}
