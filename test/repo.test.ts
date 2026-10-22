import { test, expect } from 'vitest';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnRunner } from '../src/exec.js';
import {
  parseRemote, findRepoRoot, gitDir, originUrl, isIgnored, isTracked, ensureIgnored, ensureGitattributes,
} from '../src/repo.js';
import { makeTempRepo, realpathNormalized } from './helpers.js';

test.each([
  ['https://github.com/kys/my-app.git', 'kys/my-app'],
  ['https://github.com/kys/my-app', 'kys/my-app'],
  ['git@github.com:kys/my-app.git', 'kys/my-app'],
  ['ssh://git@host:2222/kys/my-app.git', 'kys/my-app'],
  ['https://gitlab.com/group/sub/repo.git', 'group/sub/repo'],
  ['not a url', null],
])('parseRemote(%s)', (url, want) => expect(parseRemote(url)).toBe(want));

test('findRepoRoot works from a subdirectory', async () => {
  const root = await makeTempRepo();
  await mkdir(join(root, 'backend'));
  expect(await findRepoRoot(spawnRunner, join(root, 'backend'))).toBe(await realpathNormalized(root));
});

test('findRepoRoot outside git throws NOT_GIT_REPO', async () => {
  await expect(findRepoRoot(spawnRunner, await mkdtemp(join(tmpdir(), 'x'))))
    .rejects.toMatchObject({ code: 'NOT_GIT_REPO' });
});

test('gitDir and originUrl', async () => {
  const root = await makeTempRepo({ origin: 'git@github.com:kys/my-app.git' });
  expect(await gitDir(spawnRunner, root)).toBe(await realpathNormalized(join(root, '.git')));
  expect(await originUrl(spawnRunner, root)).toBe('git@github.com:kys/my-app.git');
  expect(await originUrl(spawnRunner, await makeTempRepo())).toBeNull();
});

test('isTracked', async () => {
  const root = await makeTempRepo();
  await writeFile(join(root, 'a.txt'), 'x');
  await writeFile(join(root, 'b.txt'), 'y');
  await spawnRunner('git', ['add', 'a.txt'], { cwd: root });
  expect(await isTracked(spawnRunner, root, 'a.txt')).toBe(true);
  expect(await isTracked(spawnRunner, root, 'b.txt')).toBe(false);
});

test('ensureIgnored skips already-ignored and appends the rest', async () => {
  const root = await makeTempRepo();
  await writeFile(join(root, '.gitignore'), '.env\n');
  const added = await ensureIgnored(spawnRunner, root, ['.env', 'config/app.yml', '*.envsync-backup']);
  expect(added).toEqual(['/config/app.yml', '*.envsync-backup']);
  expect(await isIgnored(spawnRunner, root, 'config/app.yml')).toBe(true);
  expect(await ensureIgnored(spawnRunner, root, ['config/app.yml', '*.envsync-backup'])).toEqual([]);
});

test('ensureIgnored skips nested paths already covered by an unanchored rule', async () => {
  const root = await makeTempRepo();
  await writeFile(join(root, '.gitignore'), '.env\n');
  expect(await ensureIgnored(spawnRunner, root, ['backend/.env'])).toEqual([]);
});

test('ensureIgnored works without .gitignore and without trailing newline', async () => {
  const root = await makeTempRepo();
  expect(await ensureIgnored(spawnRunner, root, ['.env'])).toEqual(['/.env']);
  await writeFile(join(root, '.gitignore'), 'foo');
  await ensureIgnored(spawnRunner, root, ['x/.env']);
  const text = await readFile(join(root, '.gitignore'), 'utf8');
  expect(text).toContain('foo\n');
  expect(text).toContain('# envsync');
  expect(text).toContain('/x/.env');
});

test('ensureGitattributes adds a line once', async () => {
  const root = await makeTempRepo();
  await ensureGitattributes(root, '*.enc binary');
  await ensureGitattributes(root, '*.enc binary');
  expect(await readFile(join(root, '.gitattributes'), 'utf8')).toBe('*.enc binary\n');
});
