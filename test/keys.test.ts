import { generateAgeKey, recipientOf } from '../src/keys.js';

test('generated key pair matches', async () => {
  const k = await generateAgeKey();
  expect(k.identity).toMatch(/^AGE-SECRET-KEY-1/);
  expect(k.recipient).toMatch(/^age1/);
  expect(await recipientOf(k.identity)).toBe(k.recipient);
});

test('malformed identity -> EnvsyncError without key material', async () => {
  const k = await generateAgeKey();
  const broken = k.identity.slice(0, -3) + 'QQQ';
  const err = await recipientOf(broken).catch((e) => e);
  expect(err).toMatchObject({ name: 'EnvsyncError', code: 'BW_ERROR' });
  expect(String(err.message) + String(err.hint)).not.toContain(broken.slice(0, 24));
  expect(String(err.message)).not.toContain(broken.slice(20, 40));
});

test('surrounding whitespace in identity is tolerated', async () => {
  const k = await generateAgeKey();
  expect(await recipientOf(`  ${k.identity}\r\n`)).toBe(k.recipient);
});
