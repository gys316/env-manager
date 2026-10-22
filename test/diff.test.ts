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

  test('errors never contain values', () => {
    let msg = '';
    try { diffKeys(b('a: 1'), b('a: [SECRETVAL'), 'yaml'); } catch (e) { msg = String(e); }
    expect(msg).not.toContain('SECRETVAL');
  });
});
