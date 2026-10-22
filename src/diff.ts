import { parseDocument } from 'yaml';
import type { FileFormat } from './detect.js';

export type KeyDiff = { added: string[]; removed: string[]; changed: string[]; opaque: boolean };

function decode(buf: Buffer): string {
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/** dotenv 형식 파싱. 중복 키는 마지막 값이 이긴다. */
export function parseDotenv(input: string): Map<string, string> {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const out = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([^\s=#]+)\s*=(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let rest = m[2].trimStart();
    let value: string;
    if (rest.startsWith('"')) {
      let body = rest.slice(1);
      let end = findClosingQuote(body);
      while (end < 0 && i + 1 < lines.length) {
        i++;
        body += '\n' + lines[i];
        end = findClosingQuote(body);
      }
      const raw = end < 0 ? body : body.slice(0, end);
      value = raw.replace(/\\(["\\nr])/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c));
    } else if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1);
      value = end < 0 ? rest.slice(1) : rest.slice(1, end);
    } else {
      const hash = rest.search(/\s#/);
      if (hash >= 0) rest = rest.slice(0, hash);
      value = rest.trim();
    }
    out.set(key, value);
  }
  return out;
}

function findClosingQuote(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return i;
  }
  return -1;
}

/** YAML 리프 경로(`a.b`, `list[0].c`) → JSON 문자열 값. 루트가 스칼라이거나 비어 있으면 빈 맵. */
export function flattenYaml(input: string): Map<string, string> {
  const doc = parseDocument(input.replace(/^\uFEFF/, ''));
  if (doc.errors.length > 0) throw new Error('YAML 파싱 실패');
  const root: unknown = doc.toJS();
  const out = new Map<string, string>();
  if (root === null || typeof root !== 'object') return out;
  walk(root, '', out);
  return out;
}

function walk(node: unknown, path: string, out: Map<string, string>): void {
  if (Array.isArray(node) && node.length > 0) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  } else if (isPlainObject(node) && Object.keys(node).length > 0) {
    for (const [k, v] of Object.entries(node)) walk(v, path === '' ? k : `${path}.${k}`, out);
  } else {
    out.set(path, JSON.stringify(node === undefined ? null : node) ?? 'null');
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toMap(buf: Buffer, format: FileFormat): Map<string, string> {
  const text = decode(buf);
  return format === 'dotenv' ? parseDotenv(text) : flattenYaml(text);
}

/** 키 이름만 비교한다. 값은 결과에 포함하지 않는다. */
export function diffKeys(before: Buffer | null, after: Buffer, format: FileFormat): KeyDiff {
  let a: Map<string, string>;
  let b: Map<string, string>;
  try {
    a = before === null ? new Map() : toMap(before, format);
    b = toMap(after, format);
  } catch {
    return { added: [], removed: [], changed: [], opaque: true };
  }
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [k, v] of b) {
    if (!a.has(k)) added.push(k);
    else if (a.get(k) !== v) changed.push(k);
  }
  for (const k of a.keys()) if (!b.has(k)) removed.push(k);
  const sort = (x: string[]) => x.sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
  return { added: sort(added), removed: sort(removed), changed: sort(changed), opaque: false };
}
