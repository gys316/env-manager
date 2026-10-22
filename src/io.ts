import { createInterface } from 'node:readline';

export interface Io {
  interactive: boolean;
  json: boolean;
  info(msg: string): void;
  warn(msg: string): void;
  confirm(msg: string): Promise<boolean>;
  prompt(msg: string): Promise<string>;
  promptSecret(msg: string): Promise<string>;
}

/** stdin을 raw 모드로 한 글자씩 읽고 화면에 표시하지 않는다. 테스트 불가한 얇은 TTY 코드. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    let buf = '';
    const done = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.removeListener('data', onData);
      stdin.pause();
      process.stderr.write('\n');
      fn();
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(buf));
        if (ch === '\u0003') {
          return done(() => {
            reject(new Error('취소됨'));
            process.exit(130);
          });
        }
        if (ch === '\u007f' || ch === '\b') buf = Array.from(buf).slice(0, -1).join('');
        else buf += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

/** --json 모드는 항상 비대화형이다(프롬프트로 멈추지 않고 오류를 돌려준다). */
export function isInteractive(opts: { json: boolean; stdinIsTTY?: boolean; stderrIsTTY?: boolean }): boolean {
  return !opts.json && !!opts.stdinIsTTY && !!opts.stderrIsTTY;
}

export function createTerminalIo(opts: { json: boolean; stdinIsTTY?: boolean; stderrIsTTY?: boolean }): Io {
  const interactive = isInteractive({
    json: opts.json,
    stdinIsTTY: opts.stdinIsTTY ?? !!process.stdin.isTTY,
    stderrIsTTY: opts.stderrIsTTY ?? !!process.stderr.isTTY,
  });
  return {
    interactive,
    json: opts.json,
    info: (msg) => void process.stderr.write(`${msg}\n`),
    warn: (msg) => void process.stderr.write(`${msg}\n`),
    confirm: (msg) =>
      new Promise<boolean>((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        rl.question(`${msg} [y/N] `, (answer) => {
          rl.close();
          resolve(/^y(es)?$/i.test(answer.trim()));
        });
      }),
    prompt: (msg) =>
      new Promise<string>((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        rl.question(msg, (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      }),
    promptSecret: (msg) => readHidden(msg),
  };
}
