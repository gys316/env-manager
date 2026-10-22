import { fileURLToPath } from 'node:url';
import { EnvsyncError } from './errors.js';
import type { Executable, Runner, RunResult } from './exec.js';

export type SopsFormat = 'dotenv' | 'yaml' | 'binary';

export interface Sops {
  checkVersion(): Promise<void>;
  encryptFile(plainPath: string, format: SopsFormat, recipient: string): Promise<Buffer>;
  decryptFile(encPath: string, format: SopsFormat, identity: string): Promise<Buffer>;
}

const MISSING_HINT = 'winget install Mozilla.SOPS 또는 brew install sops';
/** 패키지 루트의 중립 설정(src/, dist/ 어디서든 한 단계 위). */
export const NEUTRAL_CONFIG = fileURLToPath(new URL('../sops-neutral.yaml', import.meta.url));
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
    const r = await this.sops(['--version', '--disable-version-check']);
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
    // 전역 --config로 패키지에 든 중립 설정을 지정한다. 그러지 않으면 sops가 cwd에서 위로 .sops.yaml을 찾아
    // --age는 키만 덮어쓰고 encrypted_regex 같은 나머지 규칙은 그대로 적용해, 값이 평문으로 남을 수 있다.
    // sops 3.13.3 실바이너리로 확인: .sops.yaml에 encrypted_regex: ^nomatch$가 있어도 이 방식에서는 전체 암호화되고,
    // 규칙이 맞지 않는 creation_rules가 있어도 암호화된다(통합 테스트 참고).
    const r = await this.sops(['--config', NEUTRAL_CONFIG, 'encrypt', '--age', recipient, '--input-type', format, '--output-type', format, plainPath]);
    if (r.code !== 0) throw new EnvsyncError('SOPS_ERROR', 'sops 암호화에 실패했습니다.');
    return r.stdout;
  }

  async decryptFile(encPath: string, format: SopsFormat, identity: string): Promise<Buffer> {
    const r = await this.sops(['--config', NEUTRAL_CONFIG, 'decrypt', '--input-type', format, '--output-type', format, encPath], {
      SOPS_AGE_KEY: identity,
    });
    if (r.code !== 0) {
      throw new EnvsyncError('SOPS_ERROR', 'sops 복호화에 실패했습니다.', '올바른 age 키인지, 파일이 손상되지 않았는지 확인하세요.');
    }
    return r.stdout;
  }
}
