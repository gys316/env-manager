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
