import { test, expect } from 'vitest';
import { spawnRunner } from '../src/exec.js';
import { detectFiles, fileFormat } from '../src/detect.js';
import { makeTempRepo, writeFiles } from './helpers.js';

test('detects env files and only ignored yaml', async () => {
  const root = await makeTempRepo();
  await writeFiles(root, {
    '.env': 'A=1', '.env.local': 'B=2', 'backend/.env.production': 'C=3',
    '.env.example': 'A=', 'node_modules/x/.env': 'Z=1', '.env.enc': 'x', '.env.envsync-backup': 'x',
    'config/application-local.yml': 'db: {password: x}', 'docker-compose.yml': 'services: {}',
    '.gitignore': 'config/application-local.yml\n',
  });
  expect(await detectFiles(spawnRunner, root))
    .toEqual(['.env', '.env.local', 'backend/.env.production', 'config/application-local.yml']);
});

test('fileFormat', () => {
  expect(fileFormat('a/b.yaml')).toBe('yaml');
  expect(fileFormat('.env.prod')).toBe('dotenv');
  expect(fileFormat('config.json')).toBeNull();
});

test('does not descend into git-ignored or well-known build/vendor dirs', async () => {
  const root = await makeTempRepo();
  await writeFiles(root, {
    '.gitignore': '.env*\n/out/\ncache\n*.local.yml\n',
    '.env': 'A=1',
    'backend/.env.production': 'C=3',
    'out/.env': 'X=1',
    'pkg/cache/.env': 'X=1',
    'pkg/cache/app.local.yml': 'a: 1',
    'svc/app.local.yml': 'a: 1',
    '.venv/lib/site.local.yml': 'a: 1',
    'venv/.env': 'X=1',
    'dist/.env': 'X=1',
    'build/.env': 'X=1',
    'target/.env': 'X=1',
    'vendor/.env': 'X=1',
    '.next/.env': 'X=1',
  });
  expect(await detectFiles(spawnRunner, root)).toEqual(['.env', 'backend/.env.production', 'svc/app.local.yml']);
});

test('example/sample/template names are excluded anywhere after .env', async () => {
  const root = await makeTempRepo();
  await writeFiles(root, {
    '.env.local': 'A=1',
    '.env.local.example': 'A=',
    '.env.example.local': 'A=',
    'b/.env.prod.sample': 'A=',
    'b/.env.TEMPLATE': 'A=',
    'config.example.yml': 'a: 1',
    '.gitignore': '*.yml\n',
  });
  expect(await detectFiles(spawnRunner, root)).toEqual(['.env.local']);
});

test('yaml ignore check is a single batched git call', async () => {
  const root = await makeTempRepo();
  await writeFiles(root, { 'a.yml': 'a: 1', 'b.yml': 'b: 1', 'c/d.yaml': 'd: 1', '.gitignore': 'a.yml\nd.yaml\n' });
  const calls: string[][] = [];
  const runner: typeof spawnRunner = (cmd, args, opts) => {
    calls.push([cmd, ...args]);
    return spawnRunner(cmd, args, opts);
  };
  expect(await detectFiles(runner, root)).toEqual(['a.yml', 'c/d.yaml']);
  // 디렉터리 단계(루트의 하위 폴더 c) 1번 + YAML 일괄 1번
  expect(calls.filter((c) => c.includes('check-ignore')).length).toBe(2);
});
