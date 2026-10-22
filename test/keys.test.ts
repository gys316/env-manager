import { generateAgeKey, recipientOf } from '../src/keys.js';

test('generated key pair matches', async () => {
  const k = await generateAgeKey();
  expect(k.identity).toMatch(/^AGE-SECRET-KEY-1/);
  expect(k.recipient).toMatch(/^age1/);
  expect(await recipientOf(k.identity)).toBe(k.recipient);
});
