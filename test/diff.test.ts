import { describe, expect, test } from 'vitest';
import { diffKeys, flattenYaml, parseDotenv } from '../src/diff.js';

const b = (s: string) => Buffer.from(s);

describe('diffKeys', () => {
  test('dotenv diff by key name only', () => {
    expect(diffKeys(b('A=1\nB=2\n# c\n'), b('A=1\r\nB=3\r\nC="x\ny"\r\n'), 'dotenv'))
      .toEqual({ added: ['C'], removed: [], changed: ['B'], opaque: false });
  });
  test('export prefix and quotes', () => {
    expect([...parseDotenv('export A="1"\nB=\'2\'\n')]).toEqual([['A', '1'], ['B', '2']]);
  });
  test('yaml dotted paths', () => {
    expect(diffKeys(b('db:\n  password: a\nservers:\n  - host: x\n'),
                    b('db:\n  password: b\n  user: u\nservers:\n  - host: x\n'), 'yaml'))
      .toEqual({ added: ['db.user'], removed: [], changed: ['db.password'], opaque: false });
  });
  test('unparseable yaml is opaque', () => {
    expect(diffKeys(b('a: 1'), b('a: [unclosed'), 'yaml')).toEqual({ added: [], removed: [], changed: [], opaque: true });
  });
  test('null before means all added', () => {
    expect(diffKeys(null, b('A=1\nB=2'), 'dotenv').added).toEqual(['A', 'B']);
  });
  test('BOM is stripped and removed keys are reported sorted', () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b('A=1\nZ=1\nB=1\n')]);
    expect(diffKeys(bom, b('A=1\n'), 'dotenv'))
      .toEqual({ added: [], removed: ['B', 'Z'], changed: [], opaque: false });
  });
  test('duplicate dotenv keys: last wins', () => {
    expect([...parseDotenv('A=1\nA=2\n')]).toEqual([['A', '2']]);
  });
  test('yaml list paths and scalar/empty root', () => {
    expect([...flattenYaml('list:\n  - c: 1\n')].map(([k]) => k)).toEqual(['list[0].c']);
    expect(flattenYaml('hello').size).toBe(0);
    expect(flattenYaml('').size).toBe(0);
  });
  const OPAQUE = { added: [], removed: [], changed: [], opaque: true };
  const noFragment = (d: object, ...frags: string[]) => {
    const s = JSON.stringify(d);
    for (const f of frags) expect(s).not.toContain(f);
  };

  test('single-quoted multi-line PEM value is one key, no fragments', () => {
    const after = "A=1\nCERT='-----BEGIN-----\nMIIsecretline==\nend'\nB=2\n";
    const d = diffKeys(b('A=1\n'), b(after), 'dotenv');
    expect(d).toEqual({ added: ['B', 'CERT'], removed: [], changed: [], opaque: false });
    noFragment(d, 'MIIsecretline', 'end', 'BEGIN');
    expect(parseDotenv(after).get('CERT')).toBe('-----BEGIN-----\nMIIsecretline==\nend');
  });

  test('backtick multi-line value is one key', () => {
    const d = diffKeys(null, b('K=`l1\nsecretpart=x\nl3`\nZ=1\n'), 'dotenv');
    expect(d).toEqual({ added: ['K', 'Z'], removed: [], changed: [], opaque: false });
    noFragment(d, 'secretpart');
  });

  test('double-quoted multi-line value with = inside is one key', () => {
    const d = diffKeys(null, b('K="l1\nsecretpart=x\n"\n'), 'dotenv');
    expect(d).toEqual({ added: ['K'], removed: [], changed: [], opaque: false });
  });

  test('unterminated quote -> opaque (does not swallow silently)', () => {
    for (const q of ['"', "'", '`']) {
      const d = diffKeys(b('A=1\n'), b(`A=1\nK=${q}secretvalue\nB=2\n`), 'dotenv');
      expect(d).toEqual(OPAQUE);
      noFragment(d, 'secretvalue');
    }
  });

  test('garbage line -> opaque, never reported as a key', () => {
    const d = diffKeys(b('A=1\n'), b('A=1\nMIIsecretline==\n'), 'dotenv');
    expect(d).toEqual(OPAQUE);
    noFragment(d, 'MIIsecretline');
    expect(diffKeys(null, b('A=1\njust some words\n'), 'dotenv')).toEqual(OPAQUE);
  });

  test('invalid key names -> opaque', () => {
    expect(diffKeys(null, b('9A=1\n'), 'dotenv')).toEqual(OPAQUE);
    expect(diffKeys(null, b('A-B.c_d=1\n_X=2\nexport  Y=3\n'), 'dotenv'))
      .toEqual({ added: ['A-B.c_d', 'Y', '_X'], removed: [], changed: [], opaque: false });
  });

  test('trailing comment after quoted value is fine; junk after quote -> opaque', () => {
    expect([...parseDotenv('A="x" # note\n')]).toEqual([['A', 'x']]);
    expect(diffKeys(null, b('A="x"junk\n'), 'dotenv')).toEqual(OPAQUE);
  });

  // GNU base64 기본처럼 76열로 줄바꿈한 base64.
  const wrap76 = (s: string) => s.match(/.{1,76}/g) ?? [];
  const b64Lines = (bytes: number, seed: number) =>
    wrap76(Buffer.from(Array.from({ length: bytes }, (_, i) => (i * 37 + seed) % 256)).toString('base64'));
  const B64 = wrap76('QWxhZGRpbjpvcGVuIHNlc2FtZQxxQWxhZGRpbjpvcGVuIHNlc2FtZQxxQWxhZGRpbjpvcGVuIHNlc2Ft')[0];
  const B64_2 = 'ZXhhbXBsZTEyMzQ1Njc4OWFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6QUJDREVGR0hJSktMTU5PUFFS'.slice(0, 76);

  test('real 76-col wrapped base64 values (2-/3-line, = and == padding) -> opaque, no fragments', () => {
    // 57바이트 = 76자 한 줄. 끝 줄 길이·패딩이 다양하도록 바이트 수를 고른다.
    for (const bytes of [70, 71, 130, 131, 133]) {
      for (let seed = 0; seed < 40; seed++) {
        const lines = b64Lines(bytes, seed);
        const tail = lines[lines.length - 1];
        if (!tail.endsWith('=')) continue;
        const t = ['A=1', `KEY=${lines[0]}`, ...lines.slice(1), 'B=2', ''].join('\n');
        const d = diffKeys(b('A=1\n'), b(t), 'dotenv');
        expect(d).toEqual(OPAQUE);
        for (const l of lines.slice(1)) noFragment(d, l.replace(/=+$/, ''));
      }
    }
  });

  test('wrapped unquoted base64 whose tail line ends in "=" -> opaque, fragment absent (C1 repro)', () => {
    const t = 'A=1\nKEY=QWxhZGRpbjpvcGVuIHNlc2FtZQxxQWxhZGRpbjpvcGVuIHNlc2FtZQxxQWxhZGRpbjpvcGVu\nSecretTailAbc9=\n';
    const d = diffKeys(b(''), b(t), 'dotenv');
    expect(d).toEqual(OPAQUE);
    noFragment(d, 'SecretTailAbc9');
  });

  test('76-col wrapped base64 with 2-line and 3-line tails ending in = and == -> opaque', () => {
    expect(B64.length).toBe(76);
    expect(B64_2.length).toBe(76);
    const tails = ['TailFragAbc9=', 'TailFragAbc9==', 'Zm9v=', 'Zm9v=='];
    for (const tail of tails) {
      for (const middle of [[], [B64_2]]) {
        const t = ['A=1', `KEY=${B64}`, ...middle, tail, 'B=2', ''].join('\n');
        const d = diffKeys(b('A=1\n'), b(t), 'dotenv');
        expect(d).toEqual(OPAQUE);
        noFragment(d, tail.replace(/=+$/, ''), B64_2.slice(0, 20));
      }
    }
  });

  test('standalone base64-looking empty assignment (>=16 chars, mixed case + digits) -> opaque', () => {
    const d = diffKeys(null, b('A=1\nMIIBIjANBgkqhkiG9w0=\nB=2\n'), 'dotenv');
    expect(d).toEqual(OPAQUE);
    noFragment(d, 'MIIBIjANBgkqhkiG9w0');
  });

  test('ordinary empty assignments are still listed', () => {
    const t = 'A=\nEMPTY=\nNAME=hello\nAPI_KEY=\nexport Z=\nTOKEN=short_value\nOPTIONAL=\nDATABASE_URL_FALLBACK=\n';
    expect(diffKeys(null, b(t), 'dotenv')).toEqual({
      added: ['A', 'API_KEY', 'DATABASE_URL_FALLBACK', 'EMPTY', 'NAME', 'OPTIONAL', 'TOKEN', 'Z'],
      removed: [],
      changed: [],
      opaque: false,
    });
    // 긴 base64 값이 있어도 다음 줄이 빈 대입이 아니면 정상.
    expect(diffKeys(null, b(`KEY=${B64}\nB=2\n`), 'dotenv'))
      .toEqual({ added: ['B', 'KEY'], removed: [], changed: [], opaque: false });
    // 따옴표로 감싼 긴 값 뒤의 빈 대입은 정상.
    expect(diffKeys(null, b(`KEY="${B64}"\nEMPTY=\n`), 'dotenv'))
      .toEqual({ added: ['EMPTY', 'KEY'], removed: [], changed: [], opaque: false });
  });

  test('errors never contain values', () => {
    let msg = '';
    try { diffKeys(b('a: 1'), b('a: [SECRETVAL'), 'yaml'); } catch (e) { msg = String(e); }
    expect(msg).not.toContain('SECRETVAL');
  });
});
