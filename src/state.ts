import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type FileState = { hash: string; remoteVersion: string };

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export class SyncState {
  private constructor(
    private readonly dir: string,
    private files: Record<string, FileState>,
  ) {}

  static async load(gitDir: string): Promise<SyncState> {
    const dir = join(gitDir, 'envsync');
    const files: Record<string, FileState> = {};
    try {
      const parsed = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
      if (parsed?.version === 1 && typeof parsed.files === 'object' && parsed.files !== null) {
        for (const [k, v] of Object.entries(parsed.files as Record<string, unknown>)) {
          const s = v as Partial<FileState> | null;
          if (s && typeof s.hash === 'string' && typeof s.remoteVersion === 'string') {
            files[k] = { hash: s.hash, remoteVersion: s.remoteVersion };
          }
        }
      }
    } catch {
      // missing or corrupt -> empty state
    }
    return new SyncState(dir, files);
  }

  get(path: string): FileState | undefined {
    return Object.hasOwn(this.files, path) ? this.files[path] : undefined;
  }

  set(path: string, s: FileState): void {
    this.files[path] = { hash: s.hash, remoteVersion: s.remoteVersion };
  }

  async save(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, 'state.json'), JSON.stringify({ version: 1, files: this.files }, null, 2) + '\n', 'utf8');
  }
}
