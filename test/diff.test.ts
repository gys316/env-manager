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
  test('errors never contain values', () => {
    let msg = '';
    try { diffKeys(b('a: 1'), b('a: [SECRETVAL'), 'yaml'); } catch (e) { msg = String(e); }
    expect(msg).not.toContain('SECRETVAL');
  });
});
