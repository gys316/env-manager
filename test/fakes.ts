import { EnvsyncError } from '../src/errors.js';
import type { Runner } from '../src/exec.js';
import type { Note, Vault, VaultStatus } from '../src/bitwarden.js';
import type { Io } from '../src/io.js';

export type RecordedCall = { command: string; args: string[]; input?: string | Buffer; env?: Record<string, string> };

/** 응답을 순서대로 소비하는 녹화용 Runner. args는 prefixArgs 이후(러너에 전달된 그대로)다. */
export function recordingRunner(responses: Array<{ code?: number; stdout?: string; stderr?: string }>): {
  run: Runner;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let i = 0;
  const run: Runner = async (command, args, opts) => {
    calls.push({ command, args: [...args], input: opts?.input, env: opts?.env });
    const r = responses[i++];
    if (!r) throw new Error(`recordingRunner: unexpected call #${i} (${args.join(' ')})`);
    return { code: r.code ?? 0, stdout: Buffer.from(r.stdout ?? '', 'utf8'), stderr: r.stderr ?? '' };
  };
  return { run, calls };
}

export class FakeVault implements Vault {
  state: VaultStatus;
  password?: string;
  notes = new Map<string, Note>();
  private seq = 0;
  private ids = 0;

  constructor(opts: { state?: VaultStatus; password?: string } = {}) {
    this.state = opts.state ?? 'unlocked';
    this.password = opts.password;
  }

  async status(): Promise<VaultStatus> {
    return this.state;
  }

  async unlock(password: string): Promise<void> {
    if (this.password === undefined || password !== this.password) {
      throw new EnvsyncError('BW_ERROR', '마스터 비밀번호가 틀렸거나 잠금 해제 실패');
    }
    this.state = 'unlocked';
  }

  async sync(): Promise<void> {}

  async findNote(name: string): Promise<Note | null> {
    return this.notes.get(name) ?? null;
  }

  async upsertNote(name: string, content: string): Promise<Note> {
    const existing = this.notes.get(name);
    const note: Note = {
      id: existing?.id ?? `id-${++this.ids}`,
      name,
      notes: content,
      revisionDate: `rev-${++this.seq}`,
    };
    this.notes.set(name, note);
    return note;
  }
}

export class MemoryIo implements Io {
  interactive: boolean;
  json: boolean;
  confirmAnswer: boolean;
  secret: string;
  messages: string[] = [];
  prompts: string[] = [];

  constructor(opts: { interactive?: boolean; json?: boolean; confirmAnswer?: boolean; secret?: string } = {}) {
    this.interactive = opts.interactive ?? true;
    this.json = opts.json ?? false;
    this.confirmAnswer = opts.confirmAnswer ?? true;
    this.secret = opts.secret ?? '';
  }

  info(msg: string): void {
    this.messages.push(msg);
  }
  warn(msg: string): void {
    this.messages.push(msg);
  }
  async confirm(msg: string): Promise<boolean> {
    this.prompts.push(msg);
    return this.confirmAnswer;
  }
  async promptSecret(msg: string): Promise<string> {
    this.prompts.push(msg);
    return this.secret;
  }
}
