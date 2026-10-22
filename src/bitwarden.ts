import { EnvsyncError } from './errors.js';
import type { Executable, Runner, RunResult } from './exec.js';

export type VaultStatus = 'unauthenticated' | 'locked' | 'unlocked';
export type Note = { id: string; name: string; notes: string; revisionDate: string };

export interface Vault {
  status(): Promise<VaultStatus>;
  unlock(password: string): Promise<void>;
  sync(): Promise<void>;
  findNote(name: string): Promise<Note | null>;
  upsertNote(name: string, content: string): Promise<Note>;
}

const FOLDER_NAME = 'envsync';
const MISSING_HINT = 'winget install Bitwarden.CLI 또는 npm i -g @bitwarden/cli';

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

export class BwCli implements Vault {
  private folderId?: string;

  constructor(
    private readonly runner: Runner,
    private readonly exe: Executable | null,
    private session?: string,
  ) {}

  /** 비밀(stdin/env 내용)이 오류 메시지에 들어가지 않도록 메시지는 고정 문구만 쓴다. */
  private async bw(args: string[], opts: { input?: string; extraEnv?: Record<string, string> } = {}): Promise<RunResult> {
    if (!this.exe) throw new EnvsyncError('MISSING_DEPENDENCY', 'Bitwarden CLI(bw)를 찾을 수 없습니다.', MISSING_HINT);
    const env: Record<string, string> = { ...opts.extraEnv };
    if (this.session) env.BW_SESSION = this.session;
    const r = await this.runner(this.exe.command, [...this.exe.prefixArgs, ...args], { input: opts.input, env });
    if (r.code === 0) return r;
    if (r.code === 127) throw new EnvsyncError('MISSING_DEPENDENCY', 'Bitwarden CLI(bw)를 실행할 수 없습니다.', MISSING_HINT);
    const err = r.stderr.toLowerCase();
    if (err.includes('not logged in')) throw new EnvsyncError('NOT_LOGGED_IN', 'Bitwarden에 로그인되어 있지 않습니다.', 'bw login');
    if (err.includes('locked')) throw new EnvsyncError('VAULT_LOCKED', 'Bitwarden 보관함이 잠겨 있습니다.');
    throw new EnvsyncError('BW_ERROR', `bw ${args.slice(0, 2).join(' ')} 실행에 실패했습니다.`);
  }

  private parse<T>(r: RunResult): T {
    try {
      return JSON.parse(r.stdout.toString('utf8')) as T;
    } catch {
      throw new EnvsyncError('BW_ERROR', 'bw 출력을 해석할 수 없습니다.');
    }
  }

  async status(): Promise<VaultStatus> {
    const s = this.parse<{ status?: string }>(await this.bw(['status'])).status;
    if (s !== 'unauthenticated' && s !== 'locked' && s !== 'unlocked') {
      throw new EnvsyncError('BW_ERROR', 'bw 상태를 알 수 없습니다.');
    }
    return s;
  }

  async unlock(password: string): Promise<void> {
    let token = '';
    try {
      const r = await this.bw(['unlock', '--passwordenv', 'ENVSYNC_BW_PASSWORD', '--raw'], {
        extraEnv: { ENVSYNC_BW_PASSWORD: password },
      });
      token = r.stdout.toString('utf8').trim();
    } catch (e) {
      if (e instanceof EnvsyncError && e.code === 'MISSING_DEPENDENCY') throw e;
      throw new EnvsyncError('BW_ERROR', '마스터 비밀번호가 틀렸거나 잠금 해제 실패');
    }
    if (!token) throw new EnvsyncError('BW_ERROR', '마스터 비밀번호가 틀렸거나 잠금 해제 실패');
    this.session = token;
  }

  async sync(): Promise<void> {
    await this.bw(['sync']);
  }

  private async lookupFolder(create: boolean): Promise<string | null> {
    if (this.folderId) return this.folderId;
    const folders = this.parse<Array<{ id: string; name: string }>>(
      await this.bw(['list', 'folders', '--search', FOLDER_NAME]),
    );
    const found = folders.find((f) => f.name === FOLDER_NAME);
    if (found) return (this.folderId = found.id);
    if (!create) return null;
    const made = this.parse<{ id: string }>(await this.bw(['create', 'folder'], { input: b64({ name: FOLDER_NAME }) }));
    return (this.folderId = made.id);
  }

  async findNote(name: string): Promise<Note | null> {
    const folderId = await this.lookupFolder(false);
    if (!folderId) return null;
    const items = this.parse<Array<Note & { type?: number }>>(
      await this.bw(['list', 'items', '--folderid', folderId, '--search', name]),
    );
    const hits = items.filter((i) => i.name === name && i.type === 2);
    if (hits.length === 0) return null;
    if (hits.length > 1) {
      throw new EnvsyncError('DUPLICATE_ITEM', `같은 이름의 항목이 ${hits.length}개 있습니다: ${name}`, 'Bitwarden에서 중복 항목을 정리하세요.');
    }
    const h = hits[0];
    // 실제 bw는 빈 노트에 notes: null을 돌려준다.
    return { id: h.id, name: h.name, notes: h.notes ?? '', revisionDate: h.revisionDate };
  }

  async upsertNote(name: string, content: string): Promise<Note> {
    const folderId = (await this.lookupFolder(true)) as string;
    const existing = await this.findNote(name);
    let result: Note;
    if (!existing) {
      result = this.parse<Note>(
        await this.bw(['create', 'item'], {
          input: b64({ type: 2, name, notes: content, folderId, secureNote: { type: 0 } }),
        }),
      );
    } else {
      const item = this.parse<Record<string, unknown>>(await this.bw(['get', 'item', existing.id]));
      item.notes = content;
      result = this.parse<Note>(await this.bw(['edit', 'item', existing.id], { input: b64(item) }));
    }
    return { id: result.id, name: result.name, notes: result.notes ?? '', revisionDate: result.revisionDate };
  }
}
