import { parseDocument } from 'yaml';
import type { FileFormat } from './detect.js';

export type KeyDiff = { added: string[]; removed: string[]; changed: string[]; opaque: boolean };

function decode(buf: Buffer): string {
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/** 해석할 수 없는 dotenv. 메시지에 파일 내용을 넣지 않는다. */
class DotenvParseError extends Error {
  constructor() {
    super('dotenv 파싱 실패');
  }
}

const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/;
const QUOTES = new Set(['"', "'", '`']);
/** 줄바꿈된 base64의 첫 줄로 보이는 따옴표 없는 값. */
const LONG_BASE64 = /^[A-Za-z0-9+/]{40,}={0,2}$/;
/** 대·소문자·숫자가 섞인 16자 이상 이름: base64 조각일 가능성이 커서 빈 대입으로 해석하지 않는다. */
const isBase64LikeName = (k: string) =>
  k.length >= 16 && /^[A-Za-z0-9]+$/.test(k) && /[A-Z]/.test(k) && /[a-z]/.test(k) && /[0-9]/.test(k);

/**
 * dotenv 형식 파싱. 중복 키는 마지막 값이 이긴다.
 * 주석·빈 줄·`KEY=` 대입(따옴표 안의 여러 줄 값 포함) 외의 줄이 하나라도 있거나 따옴표가 닫히지 않으면
 * 값 조각이 키 이름으로 새지 않도록 예외를 던진다(diffKeys는 opaque로 처리).
 */
export function parseDotenv(input: string): Map<string, string> {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const out = new Map<string, string>();
  // 바로 앞 줄이 따옴표 없는 긴 base64 값이었는지(줄바꿈된 값의 다음 줄일 수 있음).
  let prevLongBase64 = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) {
      prevLongBase64 = false;
      continue;
    }
    const m = ASSIGNMENT.exec(lines[i].trimStart());
    // `KEY==...`는 base64 조각(PEM 끝 줄 등)일 가능성이 커서 해석하지 않는다.
    if (!m || m[2].startsWith('=')) throw new DotenvParseError();
    const key = m[1];
    // `조각=`처럼 값이 빈 대입이 base64 끝 줄일 수 있으면 조각이 키 이름으로 새지 않도록 해석하지 않는다.
    if (m[2].trim() === '' && /^[A-Za-z0-9]+$/.test(key) && (prevLongBase64 || isBase64LikeName(key))) {
      throw new DotenvParseError();
    }
    prevLongBase64 = false;
    let rest = m[2].trimStart();
    let value: string;
    const q = rest[0];
    if (q !== undefined && QUOTES.has(q)) {
      let body = rest.slice(1);
      let end = findClosingQuote(body, q);
      while (end < 0 && i + 1 < lines.length) {
        i++;
        body += '\n' + lines[i];
        end = findClosingQuote(body, q);
      }
      if (end < 0) throw new DotenvParseError();
      const tail = body.slice(end + 1).trim();
      if (tail !== '' && !tail.startsWith('#')) throw new DotenvParseError();
      const raw = body.slice(0, end);
      value = q === '"' ? raw.replace(/\\(["\\nr])/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c)) : raw;
    } else {
      const hash = rest.search(/\s#/);
      if (hash >= 0) rest = rest.slice(0, hash);
      value = rest.trim();
      prevLongBase64 = LONG_BASE64.test(value);
    }
    out.set(key, value);
  }
  return out;
}

/** 큰따옴표만 백슬래시 이스케이프를 인정한다. */
function findClosingQuote(s: string, q: string): number {
  for (let i = 0; i < s.length; i++) {
    if (q === '"' && s[i] === '\\') i++;
    else if (s[i] === q) return i;
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
